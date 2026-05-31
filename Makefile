.PHONY: help build up down restart logs ps backend-dev backend-build backend-test lint format \
	trigger-oom trigger-timeout trigger-port

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  build           Build all docker services (docker compose build)"
	@echo "  up              Start full stack in background (docker compose up -d)"
	@echo "  down            Stop and remove containers (docker compose down)"
	@echo "  restart         Restart the full stack"
	@echo "  logs            Follow logs for all services"
	@echo "  ps              List running compose services"
	@echo "  backend-dev     Run backend in dev mode (npm run start:dev)"
	@echo "  backend-build   Build backend (npm run build)"
	@echo "  backend-test    Run backend tests (npm test)"
	@echo "  lint            Run backend linter"
	@echo "  format          Format backend sources"
	@echo "  trigger-oom     Trigger demo OOM crash"
	@echo "  trigger-timeout Trigger demo timeout crash"
	@echo "  trigger-port    Trigger demo port conflict crash"

build:
	@echo "Building docker images..."
	docker compose build

up:
	@echo "Starting full stack..."
	docker compose up -d

down:
	@echo "Stopping stack..."
	docker compose down

restart: down up

logs:
	@echo "Tailing docker compose logs..."
	docker compose logs -f --tail=200

ps:
	@echo "Running docker compose services..."
	docker compose ps

backend-dev:
	@echo "Starting backend in dev mode..."
	cd backend && npm run start:dev

backend-build:
	@echo "Building backend..."
	cd backend && npm run build

backend-test:
	@echo "Running backend tests..."
	cd backend && npm test

lint:
	@echo "Running linter..."
	cd backend && npm run lint

format:
	@echo "Formatting source files..."
	cd backend && npm run format

trigger-oom:
	@echo "Triggering OOM crash..."
	curl -s -X GET http://localhost:3002/crash/oom || true

trigger-timeout:
	@echo "Triggering timeout crash..."
	curl -s -X GET http://localhost:3002/crash/timeout || true

trigger-port:
	@echo "Triggering port conflict crash..."
	curl -s -X GET http://localhost:3002/crash/port || true
