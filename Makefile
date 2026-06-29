# ─────────────────────────────────────────────────────────────────────────────
# Project Aegis — Makefile
# Convenience commands for development and CI/CD
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help build build-cli build-docker lint typecheck test format \
        infra-up infra-down infra-restart verify \
        dev dev-safe start stop \
        docker-build docker-push release clean

# ─── Default ────────────────────────────────────────────────────────────────
help: ## Show this help
	@echo ""
	@echo "  \033[1mProject Aegis — Available Commands\033[0m"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ─── Build ──────────────────────────────────────────────────────────────────
build: ## Build NestJS backend
	npm run build

build-cli: ## Build CLI tool
	npm run build:cli

build-all: build build-cli ## Build backend + CLI

build-docker: ## Build all Docker images locally
	docker compose build

# ─── Quality ────────────────────────────────────────────────────────────────
lint: ## Run ESLint
	npm run lint

typecheck: ## Run TypeScript type checking
	npm run typecheck

test: ## Run unit tests
	npm run test

format: ## Format code with Prettier
	npm run format

quality: lint typecheck test ## Run all quality checks

# ─── Infrastructure ─────────────────────────────────────────────────────────
infra-up: ## Start Docker infrastructure
	npm run infra:up

infra-down: ## Stop Docker infrastructure
	npm run infra:down

infra-restart: infra-down infra-restart ## Restart infrastructure
	docker compose up -d --build

verify: ## Run runtime verification
	npm run verify

# ─── Development ────────────────────────────────────────────────────────────
dev: ## Start backend in dev mode
	npm run start:dev

dev-safe: ## Start full stack (infra + backend)
	npm run dev:safe

start: ## Start production server
	npm run start:prod

stop: ## Stop all containers
	docker compose down

# ─── Docker Publishing ──────────────────────────────────────────────────────
docker-build-ai: ## Build AI Engine Docker image
	docker build -t aegis-ai-engine:latest ./services/ai-engine

docker-build-demo: ## Build Demo Crash Service Docker image
	docker build -t aegis-demo:latest ./services/demo-crash-service

docker-push-ai: docker-build-ai ## Push AI Engine to registry
	@OWNER=$$(echo "$(REGISTRY)" | tr '[:upper:]' '[:lower:]'); \
	docker tag aegis-ai-engine:latest $$OWNER/aegis/ai-engine:latest; \
	docker push $$OWNER/aegis/ai-engine:latest

docker-push-demo: docker-build-demo ## Push Demo Service to registry
	@OWNER=$$(echo "$(REGISTRY)" | tr '[:upper:]' '[:lower:]'); \
	docker tag aegis-demo:latest $$OWNER/aegis/demo-crash-service:latest; \
	docker push $$OWNER/aegis/demo-crash-service:latest

# ─── Release ────────────────────────────────────────────────────────────────
release-tag: ## Create a release tag (usage: make release-tag v=1.0.0)
	@if [ -z "$(v)" ]; then echo "Usage: make release-tag v=1.0.0"; exit 1; fi
	git tag -a $(v) -m "Release $(v)"
	git push origin $(v)
	@echo "✅ Tag $(v) pushed. CD pipeline will build and publish images."

# ─── Cleanup ────────────────────────────────────────────────────────────────
clean: ## Clean build artifacts
	rm -rf dist/ coverage/ node_modules/.cache
	docker compose down -v --rmi local 2>/dev/null || true
	@echo "✅ Cleaned build artifacts and local Docker resources"
