"""initial schema: users, listings, bids, watches, chats, messages, purchases, notifications

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# IF NOT EXISTS lets this adopt a database created before migrations existed.
STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    """
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  initials      TEXT NOT NULL,
  city          TEXT NOT NULL,
  member_since  INT NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  positive      REAL NOT NULL DEFAULT 100,
  ratings       INT NOT NULL DEFAULT 0,
  reply_time    TEXT
)
    """,
    """
CREATE TABLE IF NOT EXISTS listings (
  id           SERIAL PRIMARY KEY,
  seller_id    INT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  format       TEXT NOT NULL CHECK (format IN ('fixed','auction','offer','free')),
  price        INT NOT NULL DEFAULT 0,
  buy_now      INT,
  current_bid  INT,
  bids_count   INT NOT NULL DEFAULT 0,
  closes_at    TIMESTAMPTZ,
  location     TEXT NOT NULL,
  distance_km  REAL NOT NULL DEFAULT 0,
  condition    TEXT NOT NULL DEFAULT 'Used · good',
  specs        JSONB NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  featured     BOOLEAN NOT NULL DEFAULT FALSE,
  views        INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)
    """,
    "CREATE INDEX IF NOT EXISTS listings_title_trgm ON listings USING gin (lower(title) gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS listings_active_best ON listings (featured DESC, views DESC) WHERE status = 'active'",
    "CREATE INDEX IF NOT EXISTS listings_active_new ON listings (created_at DESC) WHERE status = 'active'",
    "CREATE INDEX IF NOT EXISTS listings_category ON listings (category) WHERE status = 'active'",
    "CREATE INDEX IF NOT EXISTS listings_seller ON listings (seller_id)",
    "CREATE INDEX IF NOT EXISTS listings_closing ON listings (closes_at) WHERE status = 'active' AND format = 'auction'",
    """
CREATE TABLE IF NOT EXISTS bids (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id),
  user_id     INT NOT NULL REFERENCES users(id),
  amount      INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
    """,
    "CREATE INDEX IF NOT EXISTS bids_listing_amount ON bids (listing_id, amount DESC)",
    """
CREATE TABLE IF NOT EXISTS watches (
  user_id     INT NOT NULL REFERENCES users(id),
  listing_id  INT NOT NULL REFERENCES listings(id),
  PRIMARY KEY (user_id, listing_id)
)
    """,
    "CREATE INDEX IF NOT EXISTS watches_listing ON watches (listing_id)",
    """
CREATE TABLE IF NOT EXISTS chats (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id),
  buyer_id    INT NOT NULL REFERENCES users(id),
  seller_id   INT NOT NULL REFERENCES users(id),
  UNIQUE (listing_id, buyer_id)
)
    """,
    "CREATE INDEX IF NOT EXISTS chats_buyer ON chats (buyer_id)",
    "CREATE INDEX IF NOT EXISTS chats_seller ON chats (seller_id)",
    """
CREATE TABLE IF NOT EXISTS messages (
  id            SERIAL PRIMARY KEY,
  chat_id       INT NOT NULL REFERENCES chats(id),
  sender_id     INT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL DEFAULT 'text',
  body          TEXT NOT NULL DEFAULT '',
  amount        INT,
  offer_status  TEXT,
  read          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
    """,
    "CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, id)",
    "CREATE INDEX IF NOT EXISTS messages_unread ON messages (chat_id) WHERE NOT read",
    """
CREATE TABLE IF NOT EXISTS purchases (
  user_id     INT NOT NULL REFERENCES users(id),
  listing_id  INT NOT NULL REFERENCES listings(id),
  status      TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
)
    """,
    """
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  text        TEXT NOT NULL,
  listing_id  INT REFERENCES listings(id),
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
    """,
    "CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, id DESC)",
]

TABLES = ["notifications", "purchases", "messages", "chats", "watches", "bids", "listings", "users"]


def upgrade() -> None:
    for sql in STATEMENTS:
        op.execute(sql)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
