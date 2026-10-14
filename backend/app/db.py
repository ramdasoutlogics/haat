"""Postgres connection pool (asyncpg) and Redis client, shared by the API and the worker.

The schema is managed by Alembic (backend/migrations) and only changes when you run `make migrate`.
"""
import json

import asyncpg
import redis.asyncio as aioredis

from .config import settings


async def _init_conn(conn: asyncpg.Connection) -> None:
    # Return JSONB columns as Python objects.
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        init=_init_conn,
    )


def create_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.redis_url)

