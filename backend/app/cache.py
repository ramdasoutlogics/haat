"""Redis cache for hot reads (search, categories, listing pages) and buffered view counts."""
import hashlib
from typing import Any, Awaitable, Callable

import orjson
import redis.asyncio as aioredis

VERSION_KEY = "ver:listings"
VIEWS_KEY = "views:pending"


class Cache:
    def __init__(self, r: aioredis.Redis, ttl: int):
        self.r = r
        self.ttl = ttl

    async def version(self) -> int:
        return int(await self.r.get(VERSION_KEY) or 0)

    async def invalidate(self) -> None:
        """Any write to listings bumps the version, so every cached listing read goes stale at once."""
        await self.r.incr(VERSION_KEY)

    async def get_or_set(self, name: str, params: Any, producer: Callable[[], Awaitable[Any]], ttl: int | None = None) -> Any:
        digest = hashlib.blake2s(orjson.dumps(params, option=orjson.OPT_SORT_KEYS), digest_size=12).hexdigest()
        key = f"c:{await self.version()}:{name}:{digest}"
        hit = await self.r.get(key)
        if hit is not None:
            return orjson.loads(hit)
        value = await producer()
        await self.r.set(key, orjson.dumps(value), ex=ttl or self.ttl)
        return value

    async def add_view(self, listing_id: int) -> int:
        """Count a view in Redis; the worker writes the totals to Postgres every minute."""
        return await self.r.hincrby(VIEWS_KEY, str(listing_id), 1)

    async def pending_views(self, listing_id: int) -> int:
        return int(await self.r.hget(VIEWS_KEY, str(listing_id)) or 0)
