"""watchlist: remember when an item was saved and its price then (for price drops)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE watches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()")
    op.execute("ALTER TABLE watches ADD COLUMN IF NOT EXISTS saved_price INT")
    # Items already saved start from today's price.
    op.execute("""UPDATE watches w SET saved_price = COALESCE(l.current_bid, l.price)
                  FROM listings l WHERE l.id = w.listing_id AND w.saved_price IS NULL""")
    op.execute("CREATE INDEX IF NOT EXISTS watches_user_new ON watches (user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS watches_user_new")
    op.execute("ALTER TABLE watches DROP COLUMN IF EXISTS saved_price")
    op.execute("ALTER TABLE watches DROP COLUMN IF EXISTS created_at")
