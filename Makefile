# Payday Budget — native tooling only. No containers anywhere in this repo.
.DEFAULT_GOAL := help
.PHONY: help dev dev-backend dev-frontend test test-backend test-frontend e2e lint lint-backend \
        lint-frontend fmt migrate build install clean

BACKEND  := backend
FRONTEND := frontend
UV       := uv --directory $(BACKEND)
NPM      := npm --prefix $(FRONTEND)

help: ## Show the available targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies
	$(UV) sync
	$(NPM) install

dev: ## Run the API on :8000 (reload) and Vite on :5173 together
	@echo "API  http://127.0.0.1:8000   UI  http://127.0.0.1:5173   (ctrl-c stops both)"
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

dev-backend: ## Run only the API with reload
	$(UV) run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

dev-frontend: ## Run only the Vite dev server
	$(NPM) run dev

test: test-backend test-frontend ## Run pytest and vitest

test-backend:
	$(UV) run pytest -q

test-frontend:
	$(NPM) run test

e2e: ## Playwright keyboard E2E against a throwaway server on :8765 (builds the SPA)
	$(NPM) run e2e

lint: lint-backend lint-frontend ## ruff + eslint + tsc --noEmit

lint-backend:
	$(UV) run ruff check .
	$(UV) run ruff format --check .

lint-frontend:
	$(NPM) run lint

fmt: ## ruff format + prettier
	$(UV) run ruff format .
	$(UV) run ruff check --fix .
	$(NPM) run fmt

migrate: ## alembic upgrade head
	$(UV) run alembic upgrade head

build: ## Production SPA build into frontend/dist
	$(NPM) run build

clean: ## Remove build output and caches
	rm -rf $(FRONTEND)/dist $(FRONTEND)/node_modules/.tmp
	find $(BACKEND) -name '__pycache__' -type d -prune -exec rm -rf {} +
