"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    # Write plain SQL, e.g. op.execute("ALTER TABLE listings ADD COLUMN sold_at TIMESTAMPTZ")
    # Big table? Build indexes with CREATE INDEX CONCURRENTLY inside `with op.get_context().autocommit_block():`
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
