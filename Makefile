# Haat: common commands. Run `make up`, then `make migrate` and `make seed` the first time.
.PHONY: up down logs migrate seed revision dev-api dev-worker

up:            ## build and start everything
	docker compose up -d --build

down:          ## stop everything (data is kept)
	docker compose down

logs:          ## follow logs from all services
	docker compose logs -f --tail=100

migrate:       ## apply database migrations
	docker compose run --rm api alembic upgrade head

seed:          ## add demo data (only if the database is empty)
	docker compose run --rm api python -m app.seed

# New migration file, e.g. make revision m="add sold_at to listings" -> backend/migrations/versions/0002_add_sold_at_to_listings.py
NEXT_REV = $(shell printf '%04d' $$(( $$(ls backend/migrations/versions | grep -c '^[0-9][0-9][0-9][0-9]_') + 1 )))
revision:
	@test -n "$(m)" || (echo 'Usage: make revision m="what changed"' && exit 1)
	docker compose run --rm --no-deps --user "$$(id -u):$$(id -g)" -v "$(CURDIR)/backend:/app" api \
		alembic revision -m "$(m)" --rev-id $(NEXT_REV)

dev-api:       ## run the API locally with auto-reload (needs local Postgres + Redis, see README)
	cd backend && uvicorn app.main:app --reload --port 8000

dev-worker:    ## run the background worker locally
	cd backend && arq app.worker.WorkerSettings
