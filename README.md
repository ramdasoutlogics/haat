# Haat

A local marketplace: buy, sell, bid and chat. Fixed price, auctions, offers and free items.

## Stack

- **API:** Python 3.13, FastAPI, asyncpg, Redis, ARQ (in `backend/`)
- **Database:** Postgres 16, migrations with Alembic
- **Web:** React + Vite SPA. The first page is rendered on the server (Node/Express), every screen after that loads on demand (in `web/`)
- **Run:** Docker Compose, one `.env` file

## Quick start

You need Docker.

```sh
cp .env.example .env
make up        # build and start everything
make migrate   # create the database tables
make seed      # add demo data
```

Open http://localhost:3000

Other commands: `make logs`, `make down`.

## Settings

All settings live in `.env`.

| Key | What it does |
| --- | --- |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `POSTGRES_DB` | Database name |
| `DATABASE_URL` | Database address when running outside Docker (Docker sets its own) |
| `DB_POOL_MIN` | Database connections each API worker keeps open |
| `DB_POOL_MAX` | Most database connections each API worker may open |
| `REDIS_URL` | Redis address when running outside Docker (Docker sets its own) |
| `CACHE_TTL_SECONDS` | How long cached pages and searches are kept |
| `WEB_CONCURRENCY` | Number of API worker processes (about 1–2 per CPU core) |
| `CORS_ORIGINS` | Sites allowed to call the API, comma separated |
| `CDN_URL` | Serve images from this CDN, e.g. `https://cdn.example.com` |
| `GOOGLE_CLIENT_ID` | Google sign-in client ID (see below) |
| `GOOGLE_CLIENT_SECRET` | Google sign-in client secret |
| `PUBLIC_URL` | Address people open the site at, e.g. `https://haat.example.com` |
| `SESSION_DAYS` | How long people stay signed in (default 30) |
| `DEMO_USER_EMAIL` | Google email that takes over the demo user and its data on first sign-in |
| `DEMO_USER_ID` | The demo user's id (default 1, "Ram D.") |
| `WEB_PORT` | Port the site opens on (default 3000) |

Postgres tuning (memory, connections, SSD settings) is in `docker-compose.yml` under `db`.
It is sized for a 2 CPU / 4 GB server; the comment there says how to scale it.

## Sign in with Google

People sign in with their Google account. Browsing works without signing in; selling, bidding, offers, chats and the watchlist need it.

1. Open https://console.cloud.google.com/apis/credentials and pick (or create) a project.
2. If asked, set up the consent screen: app name "Haat", your email, audience "External".
3. Click **Create credentials → OAuth client ID**, type **Web application**.
4. Under **Authorized redirect URIs** add `http://localhost:3000/api/auth/google/callback`
   (in production: `https://your-domain/api/auth/google/callback`).
5. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Put your own Gmail in `DEMO_USER_EMAIL` to keep the demo user's listings and chats as yours.
7. Run `make migrate`, then restart the API.

Sessions are kept in Redis; signing out ends the session at once.

## Making database changes

The database only changes when you run a migration. Starting the app never changes it.

```sh
make revision m="add sold_at to listings"   # creates backend/migrations/versions/0002_add_sold_at_to_listings.py
# edit the new file: write the change in upgrade() and how to undo it in downgrade()
make migrate                                 # apply it
```

To undo the last migration: `docker compose run --rm api alembic downgrade -1`

## What makes it fast

- **Async all the way:** FastAPI with asyncpg; requests never block each other waiting on the database.
- **Several workers:** uvicorn runs `WEB_CONCURRENCY` processes with uvloop and httptools.
- **Pooled database connections:** connections are reused, not opened per request.
- **Redis cache:** searches, categories and listing pages are served from memory.
- **Fast JSON:** responses are written with orjson.
- **Background jobs:** notifications, view counts and closing auctions run in the ARQ worker, not in the request.
- **Indexes:** trigram search on titles and indexes for each way of browsing.
- **Tuned Postgres:** memory and SSD settings set in `docker-compose.yml`.
- **CDN for images:** set `CDN_URL` and images load from the CDN.
- **Server-rendered first page:** the web server sends ready HTML with its data, so the first page shows at once.
- **Lazy-loaded screens:** each screen is its own small file, downloaded only when you open it.

## Local development without Docker

You need Python 3.13, Node 22, Postgres 16 and Redis running on your machine.

```sh
cp .env.example .env               # DATABASE_URL and REDIS_URL point at localhost

cd backend
pip install -r requirements.txt
alembic upgrade head               # create tables
python -m app.seed                 # demo data
cd ..

make dev-api                       # API on http://localhost:8000 (reloads on save)
make dev-worker                    # background jobs (second terminal)
cd web && npm install && npm run dev   # site on http://localhost:3000 (third terminal)
```
