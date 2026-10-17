"""google login: link users to Google accounts

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
    op.execute("""
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub     TEXT,
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url     TEXT,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (google_sub)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)")  # stored lowercase


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS users_email")
    op.execute("DROP INDEX IF EXISTS users_google_sub")
    op.execute("""
ALTER TABLE users
  DROP COLUMN IF EXISTS last_login_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS avatar_url,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS google_sub
    """)
