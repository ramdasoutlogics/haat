"""Haat marketplace API: async FastAPI on Postgres (asyncpg pool) with a Redis cache and an ARQ job queue."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import asyncpg
import orjson
from arq import create_pool as create_arq_pool
from arq.connections import RedisSettings
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .auth import current_user, router as auth_router, session_user
from .cache import Cache
from .config import settings
from .db import create_pool, create_redis

BID_STEP = 500
CATEGORIES = ["Cars", "Property", "Mobiles", "Tech", "Home", "Fashion", "Bikes", "Pets"]

LISTING_COLS = """l.id, l.seller_id, l.title, l.category, l.format, l.price, l.buy_now, l.current_bid,
  l.bids_count, l.closes_at, l.location, l.distance_km, l.condition, l.featured, l.views, l.status, l.created_at"""
USER_COLS = "id, name, initials, city, member_since, verified, positive, ratings, reply_time"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool()
    app.state.cache = Cache(create_redis(), settings.cache_ttl_seconds)
    app.state.jobs = await create_arq_pool(RedisSettings.from_dsn(settings.redis_url))
    yield
    await app.state.jobs.aclose()
    await app.state.cache.r.aclose()
    await app.state.pool.close()


app = FastAPI(title="Haat API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_router)


def J(obj, status: int = 200) -> Response:
    """Serialize with orjson straight to bytes."""
    return Response(orjson.dumps(obj), status_code=status, media_type="application/json")


def pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


def cache(request: Request) -> Cache:
    return request.app.state.cache


async def watched_ids(db: asyncpg.Pool | asyncpg.Connection, uid: Optional[int]) -> set[int]:
    if uid is None:
        return set()
    return {r[0] for r in await db.fetch("SELECT listing_id FROM watches WHERE user_id = $1", uid)}


def personalize(listing: dict, watched: set[int], uid: Optional[int]) -> dict:
    listing["watched"] = listing["id"] in watched
    listing["mine"] = uid is not None and listing["seller_id"] == uid
    return listing


def min_bid(l) -> Optional[int]:
    if l["format"] != "auction":
        return None
    return l["current_bid"] + BID_STEP if l["current_bid"] else l["price"]


def now() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/api/health")
async def health(db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache)):
    await db.fetchval("SELECT 1")
    await c.r.ping()
    return J({"ok": True})


# ---------- Listings ----------

@app.get("/api/categories")
async def categories(db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache)):
    async def load():
        rows = await db.fetch("SELECT category, COUNT(*) AS n FROM listings WHERE status = 'active' GROUP BY category")
        counts = {r["category"]: r["n"] for r in rows}
        return [{"name": n, "count": counts.get(n, 0)} for n in CATEGORIES]
    return J(await c.get_or_set("categories", {}, load, ttl=300))


@app.get("/api/listings")
async def list_listings(
    q: str = "",
    category: Optional[str] = None,
    formats: Optional[str] = Query(None, description="comma list: fixed,auction,offer,free"),
    verified: bool = False,
    max_km: Optional[float] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    sort: Literal["best", "newest", "price_asc", "price_desc", "nearest"] = "best",
    limit: int = Query(40, le=100),
    offset: int = Query(0, ge=0),
    db: asyncpg.Pool = Depends(pool),
    c: Cache = Depends(cache),
    uid: Optional[int] = Depends(session_user),
):
    params = dict(q=q.strip().lower(), category=category, formats=formats, verified=verified, max_km=max_km,
                  min_price=min_price, max_price=max_price, sort=sort, limit=limit, offset=offset)

    async def load():
        where = ["l.status = 'active'"]
        args: list = []

        def arg(v):
            args.append(v)
            return f"${len(args)}"

        for word in params["q"].split():
            p = arg(f"%{word}%")
            where.append(f"(lower(l.title) LIKE {p} OR lower(l.category) LIKE {p})")
        if category:
            where.append(f"l.category = {arg(category)}")
        if formats:
            where.append(f"l.format = ANY({arg([f for f in formats.split(',') if f])}::text[])")
        if verified:
            where.append("u.verified")
        if max_km is not None:
            where.append(f"l.distance_km <= {arg(max_km)}")
        price = "COALESCE(l.current_bid, l.price)"
        if min_price is not None:
            where.append(f"{price} >= {arg(min_price)}")
        if max_price is not None:
            where.append(f"{price} <= {arg(max_price)}")
        order = {
            "best": "l.featured DESC, l.views DESC",
            "newest": "l.created_at DESC",
            "price_asc": f"{price} ASC",
            "price_desc": f"{price} DESC",
            "nearest": "l.distance_km ASC",
        }[sort]
        sql = (f"SELECT {LISTING_COLS}, COUNT(*) OVER () AS total FROM listings l JOIN users u ON u.id = l.seller_id "
               f"WHERE {' AND '.join(where)} ORDER BY {order}, l.id LIMIT {arg(limit)} OFFSET {arg(offset)}")
        rows = [dict(r) for r in await db.fetch(sql, *args)]
        total = rows[0]["total"] if rows else 0
        for r in rows:
            del r["total"]
        return {"total": total, "items": rows}

    data = await c.get_or_set("listings", params, load)
    w = await watched_ids(db, uid)
    data["items"] = [personalize(i, w, uid) for i in data["items"]]
    return J(data)


async def load_listing(db: asyncpg.Pool | asyncpg.Connection, lid: int) -> Optional[dict]:
    row = await db.fetchrow(f"SELECT {LISTING_COLS}, l.specs, l.description FROM listings l WHERE l.id = $1", lid)
    if not row:
        return None
    out = dict(row)
    out["seller"] = dict(await db.fetchrow(f"SELECT {USER_COLS} FROM users WHERE id = $1", row["seller_id"]))
    out["watchers"] = await db.fetchval("SELECT COUNT(*) FROM watches WHERE listing_id = $1", lid)
    out["top_bidder"] = await db.fetchval(
        "SELECT user_id FROM bids WHERE listing_id = $1 ORDER BY amount DESC LIMIT 1", lid)
    out["min_bid"] = min_bid(row)
    return out


async def listing_view(db: asyncpg.Pool, c: Cache, lid: int, uid: Optional[int], count_view: bool = False) -> dict:
    data = await c.get_or_set("listing", lid, lambda: load_listing(db, lid))
    if not data:
        raise HTTPException(404, "Listing not found")
    pending = await (c.add_view(lid) if count_view else c.pending_views(lid))
    data["views"] += pending
    top = data.pop("top_bidder")
    data["you_lead"] = uid is not None and top == uid
    return personalize(data, await watched_ids(db, uid), uid)


@app.get("/api/listings/{lid}")
async def get_listing(lid: int, db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache),
                      uid: Optional[int] = Depends(session_user)):
    return J(await listing_view(db, c, lid, uid, count_view=True))


class NewListing(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    category: str
    format: Literal["fixed", "auction", "offer", "free"]
    price: int = Field(0, ge=0)
    buy_now: Optional[int] = Field(None, ge=1)
    duration_days: int = Field(7, ge=1, le=14)
    condition: str = "Used · good"
    description: str = Field("", max_length=4000)
    location: str = "Koramangala"


@app.post("/api/listings")
async def create_listing(body: NewListing, db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache),
                         me: int = Depends(current_user)):
    if body.category not in CATEGORIES:
        raise HTTPException(422, "Unknown category")
    if body.format != "free" and body.price < 1:
        raise HTTPException(422, "Set a price")
    closes = now() + timedelta(days=body.duration_days) if body.format == "auction" else None
    lid = await db.fetchval(
        """INSERT INTO listings (seller_id, title, category, format, price, buy_now, closes_at, location,
           condition, specs, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id""",
        me, body.title.strip(), body.category, body.format, 0 if body.format == "free" else body.price,
        body.buy_now if body.format == "auction" else None, closes, body.location, body.condition,
        [{"k": "Condition", "v": body.condition}], body.description.strip())
    await c.invalidate()
    return J(await listing_view(db, c, lid, me), status=201)


@app.post("/api/listings/{lid}/watch")
async def toggle_watch(lid: int, db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache),
                       me: int = Depends(current_user)):
    deleted = await db.fetchval(
        "WITH d AS (DELETE FROM watches WHERE user_id = $1 AND listing_id = $2 RETURNING 1) SELECT COUNT(*) FROM d", me, lid)
    if not deleted:
        try:
            await db.execute("INSERT INTO watches VALUES ($1, $2) ON CONFLICT DO NOTHING", me, lid)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "Listing not found")
    await c.invalidate()
    return J({"watched": not deleted})


class Amount(BaseModel):
    amount: int = Field(ge=1, le=100_000_000)


@app.post("/api/listings/{lid}/bids")
async def place_bid(lid: int, body: Amount, request: Request, db: asyncpg.Pool = Depends(pool), c: Cache = Depends(cache),
                    me: int = Depends(current_user)):
    async with db.acquire() as conn, conn.transaction():
        # Row lock: two bids at the same moment are applied one after the other.
        l = await conn.fetchrow("SELECT * FROM listings WHERE id = $1 FOR UPDATE", lid)
        if not l or l["status"] != "active":
            raise HTTPException(404, "Listing not found")
        if l["format"] != "auction":
            raise HTTPException(400, "This listing is not an auction")
        if l["seller_id"] == me:
            raise HTTPException(400, "You can't bid on your own listing")
        if l["closes_at"] and l["closes_at"] <= now():
            raise HTTPException(400, "This auction has closed")
        if body.amount < min_bid(l):
            raise HTTPException(400, f"Minimum bid is ₹{min_bid(l):,}")
        prev = await conn.fetchval("SELECT user_id FROM bids WHERE listing_id = $1 ORDER BY amount DESC LIMIT 1", lid)
        await conn.execute("INSERT INTO bids (listing_id, user_id, amount) VALUES ($1, $2, $3)", lid, me, body.amount)
        await conn.execute("UPDATE listings SET current_bid = $1, bids_count = bids_count + 1 WHERE id = $2", body.amount, lid)
    await c.invalidate()
    if prev and prev != me:
        await request.app.state.jobs.enqueue_job("notify_outbid", prev, lid, body.amount)
    await request.app.state.jobs.enqueue_job("notify_new_bid", l["seller_id"], lid, body.amount)
    return J(await listing_view(db, c, lid, me))


async def chat_for(conn, lid: int, buyer_id: int, seller_id: int) -> int:
    return await conn.fetchval(
        """INSERT INTO chats (listing_id, buyer_id, seller_id) VALUES ($1, $2, $3)
           ON CONFLICT (listing_id, buyer_id) DO UPDATE SET seller_id = EXCLUDED.seller_id RETURNING id""",
        lid, buyer_id, seller_id)


async def active_listing(conn, lid: int, me: int):
    l = await conn.fetchrow("SELECT id, seller_id, status FROM listings WHERE id = $1", lid)
    if not l or l["status"] != "active":
        raise HTTPException(404, "Listing not found")
    if l["seller_id"] == me:
        raise HTTPException(400, "This is your own listing")
    return l


@app.post("/api/listings/{lid}/offers")
async def make_offer(lid: int, body: Amount, request: Request, db: asyncpg.Pool = Depends(pool),
                     me: int = Depends(current_user)):
    async with db.acquire() as conn, conn.transaction():
        l = await active_listing(conn, lid, me)
        cid = await chat_for(conn, lid, me, l["seller_id"])
        await conn.execute(
            "INSERT INTO messages (chat_id, sender_id, kind, body, amount, offer_status, read) "
            "VALUES ($1, $2, 'offer', 'Offer via Haat Pay', $3, 'pending', TRUE)", cid, me, body.amount)
    await request.app.state.jobs.enqueue_job("notify_offer", l["seller_id"], lid, body.amount)
    return J({"chat_id": cid})


@app.post("/api/listings/{lid}/chat")
async def open_chat(lid: int, db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    async with db.acquire() as conn:
        l = await active_listing(conn, lid, me)
        return J({"chat_id": await chat_for(conn, lid, me, l["seller_id"])})


# ---------- Chats ----------

CHAT_LIST_SQL = f"""
SELECT ch.id, ch.buyer_id, ch.seller_id,
       u.id AS u_id, u.name AS u_name, u.initials AS u_initials, u.verified AS u_verified,
       u.positive AS u_positive, u.ratings AS u_ratings, u.reply_time AS u_reply_time,
       l.id AS l_id, l.title AS l_title, l.category AS l_category, l.format AS l_format, l.price AS l_price,
       l.buy_now AS l_buy_now, l.current_bid AS l_current_bid,
       m.kind AS m_kind, m.body AS m_body, m.amount AS m_amount, m.sender_id AS m_sender, m.created_at AS m_at,
       (SELECT COUNT(*) FROM messages x WHERE x.chat_id = ch.id AND x.sender_id <> $1 AND NOT x.read) AS unread
FROM chats ch
JOIN users u ON u.id = CASE WHEN ch.buyer_id = $1 THEN ch.seller_id ELSE ch.buyer_id END
JOIN listings l ON l.id = ch.listing_id
LEFT JOIN LATERAL (SELECT * FROM messages WHERE chat_id = ch.id ORDER BY id DESC LIMIT 1) m ON TRUE
WHERE (ch.buyer_id = $1 OR ch.seller_id = $1) {{extra}}
ORDER BY m.created_at DESC NULLS LAST
"""


def chat_row(r, me: int) -> dict:
    if r["m_kind"] is None:
        last = ""
    elif r["m_kind"] == "offer":
        last = f"Offer: ₹{r['m_amount']:,}"
    else:
        last = ("You: " if r["m_sender"] == me else "") + r["m_body"]
    return {
        "id": r["id"], "role": "buying" if r["buyer_id"] == me else "selling",
        "other": {"id": r["u_id"], "name": r["u_name"], "initials": r["u_initials"], "verified": r["u_verified"],
                  "positive": r["u_positive"], "ratings": r["u_ratings"], "reply_time": r["u_reply_time"]},
        "listing": {"id": r["l_id"], "title": r["l_title"], "category": r["l_category"], "format": r["l_format"],
                    "price": r["l_price"], "buy_now": r["l_buy_now"], "current_bid": r["l_current_bid"]},
        "last": last, "last_at": r["m_at"], "unread": r["unread"],
    }


@app.get("/api/chats")
async def list_chats(db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    rows = await db.fetch(CHAT_LIST_SQL.format(extra=""), me)
    return J([chat_row(r, me) for r in rows])


async def chat_detail(conn, cid: int, me: int) -> dict:
    r = await conn.fetchrow(CHAT_LIST_SQL.format(extra="AND ch.id = $2"), me, cid)
    if not r:
        raise HTTPException(404, "Chat not found")
    await conn.execute("UPDATE messages SET read = TRUE WHERE chat_id = $1 AND sender_id <> $2 AND NOT read", cid, me)
    out = chat_row(r, me)
    out["unread"] = 0
    out["messages"] = [
        {"id": m["id"], "mine": m["sender_id"] == me, "kind": m["kind"], "body": m["body"], "amount": m["amount"],
         "offer_status": m["offer_status"], "created_at": m["created_at"]}
        for m in await conn.fetch("SELECT * FROM messages WHERE chat_id = $1 ORDER BY id", cid)
    ]
    return out


@app.get("/api/chats/{cid}")
async def get_chat(cid: int, db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    async with db.acquire() as conn:
        return J(await chat_detail(conn, cid, me))


class Text(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@app.post("/api/chats/{cid}/messages")
async def send_message(cid: int, body: Text, db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "Message is empty")
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM chats WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)", cid, me):
            raise HTTPException(404, "Chat not found")
        await conn.execute("INSERT INTO messages (chat_id, sender_id, body, read) VALUES ($1, $2, $3, TRUE)", cid, me, text)
        return J(await chat_detail(conn, cid, me), status=201)


class OfferAction(BaseModel):
    action: Literal["accept", "decline", "counter"]
    amount: Optional[int] = Field(None, ge=1)


@app.post("/api/messages/{mid}/respond")
async def respond_offer(mid: int, body: OfferAction, db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    async with db.acquire() as conn, conn.transaction():
        m = await conn.fetchrow(
            """SELECT m.* FROM messages m JOIN chats ch ON ch.id = m.chat_id
               WHERE m.id = $1 AND m.kind = 'offer' AND (ch.buyer_id = $2 OR ch.seller_id = $2) FOR UPDATE OF m""",
            mid, me)
        if not m:
            raise HTTPException(404, "Offer not found")
        if m["sender_id"] == me:
            raise HTTPException(400, "You can't respond to your own offer")
        if m["offer_status"] != "pending":
            raise HTTPException(400, "This offer was already answered")
        if body.action == "counter":
            if not body.amount:
                raise HTTPException(422, "Counter-offer needs an amount")
            await conn.execute("UPDATE messages SET offer_status = 'countered' WHERE id = $1", mid)
            await conn.execute(
                "INSERT INTO messages (chat_id, sender_id, kind, body, amount, offer_status, read) "
                "VALUES ($1, $2, 'offer', 'Counter-offer', $3, 'pending', TRUE)", m["chat_id"], me, body.amount)
        else:
            await conn.execute("UPDATE messages SET offer_status = $1 WHERE id = $2",
                               "accepted" if body.action == "accept" else "declined", mid)
        return J(await chat_detail(conn, m["chat_id"], me))


# ---------- Me ----------

@app.get("/api/me")
async def get_me(db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    async with db.acquire() as conn:
        user = dict(await conn.fetchrow(f"SELECT {USER_COLS}, avatar_url FROM users WHERE id = $1", me))
        w = await watched_ids(conn, me)
        mine = [personalize(dict(r), w, me) for r in await conn.fetch(
            f"""SELECT {LISTING_COLS},
                  (SELECT COUNT(*) FROM watches x WHERE x.listing_id = l.id) AS watchers,
                  (SELECT COUNT(*) FROM chats x WHERE x.listing_id = l.id) AS chats
                FROM listings l WHERE l.seller_id = $1 AND l.status = 'active' ORDER BY l.created_at DESC""", me)]
        watching = [personalize(dict(r), w, me) for r in await conn.fetch(
            f"SELECT {LISTING_COLS} FROM listings l JOIN watches x ON x.listing_id = l.id WHERE x.user_id = $1", me)]
        bought = [personalize(dict(r), w, me) for r in await conn.fetch(
            f"""SELECT {LISTING_COLS}, p.status AS purchase_status, u.name AS seller_name
                FROM listings l JOIN purchases p ON p.listing_id = l.id JOIN users u ON u.id = l.seller_id
                WHERE p.user_id = $1""", me)]
        unread = await conn.fetchval(
            """SELECT COUNT(*) FROM messages m JOIN chats ch ON ch.id = m.chat_id
               WHERE (ch.buyer_id = $1 OR ch.seller_id = $1) AND m.sender_id <> $1 AND NOT m.read""", me)
        notes = await conn.fetchval("SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND NOT read", me)
    earned = 46200 if me == settings.demo_user_id else 0  # demo figure until payouts exist
    return J({"user": user, "earned": earned, "listings": mine, "watching": watching, "bought": bought,
              "unread_chats": unread, "unread_notifications": notes})


@app.get("/api/notifications")
async def notifications(db: asyncpg.Pool = Depends(pool), me: int = Depends(current_user)):
    rows = await db.fetch(
        "SELECT id, text, listing_id, read, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50", me)
    await db.execute("UPDATE notifications SET read = TRUE WHERE user_id = $1 AND NOT read", me)
    return J([dict(r) for r in rows])
