"""Background worker (ARQ): notifications, flushing view counts, closing auctions.

Run with:  arq app.worker.WorkerSettings
"""
from arq import cron
from arq.connections import RedisSettings

from .cache import VIEWS_KEY, Cache
from .config import settings
from .db import create_pool, create_redis


async def startup(ctx):
    ctx["pool"] = await create_pool()
    ctx["cache"] = Cache(create_redis(), settings.cache_ttl_seconds)


async def shutdown(ctx):
    await ctx["cache"].r.aclose()
    await ctx["pool"].close()


async def _notify(ctx, user_id: int, listing_id: int, text: str) -> None:
    await ctx["pool"].execute(
        "INSERT INTO notifications (user_id, listing_id, text) VALUES ($1, $2, $3)", user_id, listing_id, text)
    # Push / SMS / email providers plug in here.


async def _title(ctx, listing_id: int) -> str:
    return await ctx["pool"].fetchval("SELECT title FROM listings WHERE id = $1", listing_id) or "your item"


async def notify_outbid(ctx, user_id: int, listing_id: int, amount: int):
    await _notify(ctx, user_id, listing_id, f"You've been outbid on {await _title(ctx, listing_id)} (₹{amount:,})")


async def notify_new_bid(ctx, user_id: int, listing_id: int, amount: int):
    await _notify(ctx, user_id, listing_id, f"New bid of ₹{amount:,} on {await _title(ctx, listing_id)}")


async def notify_offer(ctx, user_id: int, listing_id: int, amount: int):
    await _notify(ctx, user_id, listing_id, f"New offer of ₹{amount:,} on {await _title(ctx, listing_id)}")


async def flush_views(ctx):
    """Move buffered view counts from Redis into Postgres in one batch."""
    r = ctx["cache"].r
    if not await r.exists(VIEWS_KEY):
        return 0
    tmp = f"{VIEWS_KEY}:flushing"
    await r.rename(VIEWS_KEY, tmp)
    counts = {int(k): int(v) for k, v in (await r.hgetall(tmp)).items()}
    await ctx["pool"].executemany("UPDATE listings SET views = views + $2 WHERE id = $1", list(counts.items()))
    await r.delete(tmp)
    await ctx["cache"].invalidate()
    return len(counts)


async def close_auctions(ctx):
    """End auctions whose time is up: sold if there were bids, ended otherwise."""
    rows = await ctx["pool"].fetch(
        """UPDATE listings SET status = CASE WHEN bids_count > 0 THEN 'sold' ELSE 'ended' END
           WHERE status = 'active' AND format = 'auction' AND closes_at <= now()
           RETURNING id, seller_id, title, current_bid, bids_count""")
    for l in rows:
        if l["bids_count"]:
            await _notify(ctx, l["seller_id"], l["id"], f"Sold! {l['title']} for ₹{l['current_bid']:,}")
            winner = await ctx["pool"].fetchval(
                "SELECT user_id FROM bids WHERE listing_id = $1 ORDER BY amount DESC LIMIT 1", l["id"])
            await _notify(ctx, winner, l["id"], f"You won {l['title']} for ₹{l['current_bid']:,}")
        else:
            await _notify(ctx, l["seller_id"], l["id"], f"Your auction for {l['title']} ended with no bids")
    if rows:
        await ctx["cache"].invalidate()
    return len(rows)


class WorkerSettings:
    functions = [notify_outbid, notify_new_bid, notify_offer]
    cron_jobs = [cron(flush_views, second=0), cron(close_auctions, second=30)]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
