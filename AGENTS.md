# AGENTS.md — Project Aegis Architecture Reference

> Single source of truth for architecture, agent responsibilities, security boundaries, failure handling rules, validation requirements, and coding standards.

---

## Project Identity

**Project Aegis** is a headless, terminal-native, Kafka-driven, MongoDB-persistent, Docker-based, local-first, air-gapped at runtime, secure-by-design AI-assisted self-healing DevOps platform.

### Runtime Architecture

```
Container failure
        ↓
Docker Watchman
        ↓
Log and metadata extraction
        ↓
MongoDB incident persistence
        ↓
Kafka event publication
        ↓
Local AI diagnosis
        ↓
Safety policy validation
        ↓
Dockerode remediation
        ↓
MongoDB audit persistence
```

### Offline RL Component (Research Only)

```
Historical MongoDB incidents
        ↓
Replay dataset
        ↓
Offline RL training and evaluation
        ↓
Research metrics and candidate policies
```

The RL engine must never directly control Docker or bypass the NestJS policy engine.

---

## Module Responsibilities

### NestJS Backend (Control Plane)

| Module | Responsibility |
|---|---|
| `DockerModule` | Watchman — connects to `/var/run/docker.sock`, detects `die`, `oom`, `restart`, `health_status: unhealthy`, extracts logs, publishes typed Kafka events, reconnects after interruption |
| `KafkaModule` | Producer (idempotent, retry, correlation IDs), Consumer (supervised lifecycle with exponential backoff + jitter), Health tracking |
| `MongoModule` | Connection with retry, schema compilation, all collection models |
| `AiAgentModule` | HTTP client to Python AI engine, retry, safe fallback on unavailability |
| `OrchestratorModule` | Pipeline coordinator — listens for `docker.crash` events, runs AI diagnosis, enforces safety policy, executes remediation via DockerService, persists audit trail |
| `HealthModule` | Root liveness probe (`/`), health endpoint (`/api/health`), Kafka health endpoint |

### Python AI Engine

| Component | Responsibility |
|---|---|
| `main.py` | FastAPI app — `/health`, `/diagnose`, `/train` endpoints |
| `embedding_pipeline.py` | SentenceTransformer (all-MiniLM-L6-v2) encoding |
| `classifier.py` | MLP classifier — 7 incident classes |
| `vectorstore/memory.py` | FAISS similarity search |
| `kafka_client.py` | Kafka consumer thread for autonomous inference |

### CLI

| Command | Responsibility |
|---|---|
| `aegis doctor` | Infrastructure health check (Docker, MongoDB, Kafka, AI Engine, Backend, Demo Service) |
| `aegis status` | Platform snapshot (Backend health, Kafka health, containers, incidents, remediations) |
| `aegis stream` | Real-time Kafka event streaming to terminal |
| `aegis chaos <mode>` | Chaos testing (oom, timeout, crash, permission, port) |

---

## Security Boundaries

### Mandatory Rules

- **No cloud AI keys** — all inference is local
- **No external inference** — no OpenAI, Gemini, Claude, or cloud APIs
- **No shell remediation** — all Docker actions use Dockerode API
- **No AI-generated command execution** — AI returns action enums only
- **No direct RL control of Docker** — RL is offline research only
- **No automatic high-risk action** — only RESTART_CONTAINER with confidence ≥ 0.85 and risk LOW
- **No secret values in logs** — environment variables are never printed
- **`.env` ignored by Git** — via `.gitignore`
- **Docker socket documented as privileged** — `/var/run/docker.sock` mount
- **Internal containers excluded from monitoring** — `aegis-mongodb`, `aegis-kafka`, `aegis-kafka-ui`, `aegis-ai-engine`, `aegis-control-plane`
- **All actions mapped to allowlisted Dockerode methods** — `restartContainer()`, `listContainers()`, `inspectContainer()`
- **Logs sanitized before AI processing** — control characters stripped
- **API query limits bounded** — `.limit(50)` on all list endpoints
- **Errors normalized before persistence** — no raw Error objects in Kafka JSON
- **No unbounded embedding or log output** — `MAX_LOG_LINES = 100`

### Safety Policy

```typescript
const safetyPassed =
  !isFallbackDiagnosis &&
  confidenceScore >= 0.85 &&
  riskLevel === 'LOW' &&
  suggestedAction === 'RESTART_CONTAINER';
```

Allowed actions: `RESTART_CONTAINER`, `STOP_CONTAINER`, `IGNORE`

The policy engine rejects:
- Unknown action values
- Low-confidence decisions (below 0.85)
- Medium-risk decisions
- High-risk decisions
- AI fallback decisions
- Internal Aegis container targets
- Duplicate remediation attempts

Every decision is persisted in MongoDB.

---

## Failure Handling Rules

### Kafka Failure Isolation

A Kafka failure must never prevent an incident from being persisted.

Required pattern:
```
Persist incident to MongoDB
    ↓
Persist Kafka outbox event
    ↓
Attempt Kafka publication
    ↓
Mark PUBLISHED on success
    ↓
Keep PENDING on temporary failure
```

Use isolated error boundaries (separate `try/catch` blocks).

### Kafka Consumer Auto-Recovery

```
Create consumer
    ↓
Connect
    ↓
Subscribe
    ↓
Run
    ↓
Unexpected failure
    ↓
Update health to RESTARTING
    ↓
Disconnect safely
    ↓
Wait with exponential backoff and jitter
    ↓
Create a fresh consumer
    ↓
Restore subscriptions
    ↓
Resume consumption
```

- Only one restart supervisor per consumer group
- No duplicate subscriptions
- No restart after intentional shutdown
- Exponential backoff with jitter
- Unlimited recovery when `KAFKA_RESTART_MAX_ATTEMPTS=0`

### AI Engine Unavailability

When the AI engine is unreachable:
1. Persist the fallback diagnosis
2. Mark AI state degraded
3. Mark incident for review
4. Skip automatic remediation
5. Never report fallback as a successful AI diagnosis

### MongoDB Outage

MongoDB is the source of operational truth. If MongoDB is unavailable, the backend cannot function. The MongoService implements retry logic with exponential backoff.

---

## Validation Requirements

### Build

```bash
npm install              # Must succeed
npm run build            # NestJS must compile with zero errors
npm run build:cli        # CLI must compile with zero errors
```

### Infrastructure

```bash
npm run infra:up         # Docker Compose services must start
npm run wait:kafka       # Kafka must become reachable within 60s
npm run verify           # All runtime checks must pass
```

### Runtime

```bash
curl http://localhost:3001/                          # Root liveness
curl http://localhost:3001/api/health                # Health check
curl http://localhost:3001/api/orchestrator/health/kafka  # Kafka health
curl http://localhost:3001/api/orchestrator/containers    # Container list
curl http://localhost:3001/api/orchestrator/incidents     # Incidents
curl http://localhost:3001/api/orchestrator/remediations  # Remediations
curl http://localhost:8000/health                    # AI engine health
curl http://localhost:3000/health                    # Demo crash service health
```

### CLI

```bash
aegis doctor              # Must pass all checks
aegis status              # Must show platform state
aegis stream              # Must connect to Kafka
aegis chaos oom           # Must trigger and detect crash
aegis chaos crash         # Must trigger and detect crash
aegis chaos timeout       # Must trigger and detect crash
aegis chaos permission    # Must trigger and detect crash
aegis chaos port          # Must trigger and detect crash
```

---

## Coding Standards

### TypeScript

- Strict mode enabled (`strict: true`)
- `nodenext` module resolution
- `.js` extensions in imports (required for ESM-compatible NestJS output)
- No `any` types where avoidable
- All Kafka messages use typed envelopes
- All MongoDB operations use Mongoose schemas

### Logging

- Use NestJS `Logger` class
- Prefix log messages with correlation IDs
- Never log secrets or environment variable values
- Sanitize error messages before persistence

### Error Handling

- Each MongoDB write is wrapped in its own `try/catch`
- Each Kafka publication is wrapped in its own `try/catch`
- No shared await chains between MongoDB and Kafka operations
- Errors are normalized to strings before persistence

---

## Environment Variables

Required variables in `.env`:

```env
MONGODB_URI=mongodb://localhost:27017/aegis
KAFKA_BROKER=localhost:9092
KAFKA_CLIENT_ID=aegis-orchestrator
KAFKA_CONNECTION_RETRIES=15
KAFKA_RESTART_INITIAL_DELAY_MS=1000
KAFKA_RESTART_MAX_DELAY_MS=30000
KAFKA_RESTART_MAX_ATTEMPTS=0
AI_ENGINE_URL=http://localhost:8000
AI_ENGINE_TIMEOUT_MS=10000
DEMO_CRASH_SERVICE_URL=http://localhost:3000
BACKEND_PORT=3001
NODE_ENV=development
```

### Forbidden Variables

Do not use:
- `REDIS_*`
- `DATABASE_URL`
- `POSTGRES_*`
- `PRISMA_*`
- `OLLAMA_*`
- `NEXT_PUBLIC_*`

---

## Docker Compose Services

| Service | Image | Port | Health Check |
|---|---|---|---|
| `aegis-mongodb` | `mongo:7` | 27017 | `mongosh --eval "db.adminCommand('ping')"` |
| `aegis-kafka` | `apache/kafka:4.2.1` | 9092 | `kafka-topics.sh --list` |
| `aegis-kafka-ui` | `provectuslabs/kafka-ui:latest` | 8080 | None (depends on Kafka) |
| `aegis-ai-engine` | Built from `services/ai-engine/Dockerfile` | 8000 | `urllib.request.urlopen('http://localhost:8000/health')` |
| `demo-crash-service` | Built from `services/demo-crash-service/Dockerfile` | 3000 | None |

All services are on the `aegis-network` bridge network.

---

## Kafka Topics

| Topic | Purpose |
|---|---|
| `aegis.container.events` | Docker container lifecycle events |
| `aegis.incident.detected` | Crash incidents logged by orchestrator |
| `aegis.logs.extracted` | Extracted container logs |
| `aegis.ai.diagnosis.completed` | AI engine diagnosis results |
| `aegis.remediation.started` | Remediation execution started |
| `aegis.remediation.completed` | Remediation execution completed |
| `aegis.audit.events` | Audit trail events |
| `aegis.rl.feedback` | RL feedback for offline training |

---

## MongoDB Collections

| Collection | Purpose |
|---|---|
| `services` | Container status and restart counts |
| `infrastructure_events` | Raw crash logs and exit codes |
| `incident_embeddings` | 384-dimensional log embeddings |
| `remediation_plans` | AI diagnosis, risk levels, suggested actions |
| `action_executions` | Remediation outcomes and duration |
| `episodes` | RL training replay buffer |
| `metrics_snapshots` | CPU, RAM, disk checkpoints |
| `outbox_events` | Durable Kafka outbox with retry |

---

## Graceful Shutdown

On `SIGINT` and `SIGTERM`:
1. Mark Kafka supervisors as stopping
2. Stop new restart attempts
3. Stop consumers
4. Disconnect producer
5. Stop outbox worker
6. Complete active MongoDB writes
7. Close MongoDB
8. Exit cleanly

Expected logs:
```
[AEGIS] Shutdown requested
[KAFKA] Stopping consumer supervisors
[KAFKA] Disconnecting consumers
[KAFKA] Disconnecting producer
[MONGO] Completing pending writes
[AEGIS] Shutdown complete
```

---

## GitOps & CI/CD

### Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push/PR to `main`, `develop` | Lint, typecheck, build, Docker validation, integration test |
| `cd.yml` | Tag `v*`, GitHub Release | Build & push Docker images, create release with changelog |
| `docker-publish.yml` | Push to `main` | Publish `latest` Docker images to GHCR |
| `deploy.yml` | Manual dispatch | Deploy to staging/production with confirmation |

### Docker Images

Published to GitHub Container Registry (`ghcr.io`):

```
ghcr.io/<owner>/aegis/ai-engine:<version>
ghcr.io/<owner>/aegis/demo-crash-service:<version>
```

### Release Process

```bash
# 1. Create release tag
make release-tag v=1.0.0

# 2. CD pipeline builds and pushes images
# 3. GitHub Release is created with changelog
# 4. Deploy manually via workflow_dispatch
```

### Makefile Commands

```bash
make help              # Show all available commands
make build             # Build NestJS backend
make build-cli         # Build CLI tool
make build-docker      # Build all Docker images
make quality           # Run lint + typecheck + test
make dev-safe          # Start full stack
make release-tag v=1.0.0  # Create release tag
make clean             # Clean build artifacts
```

### Dependabot

Automated dependency updates for:
- npm packages (weekly, Monday 09:00 UTC)
- GitHub Actions (weekly)
- Python pip packages (weekly)

### Environment Variables for CI/CD

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Auto-provided, used for GHCR auth |
| `REGISTRY` | Container registry (default: `ghcr.io`) |

---

## CLI Enhancements

### New Commands (Phase 1-5)

| Command | Purpose |
|---|---|
| `aegis containers list` | List monitored containers |
| `aegis containers inspect <name>` | Container details + crash history |
| `aegis containers logs <name>` | Recent crash logs |
| `aegis incidents list` | List recent incidents |
| `aegis incidents inspect <id>` | Full incident detail |
| `aegis exclude list` | Show exclusion rules |
| `aegis exclude add <name>` | Add to exclusion list |
| `aegis exclude remove <name>` | Remove from exclusion list |
| `aegis dashboard` | Live terminal dashboard |

### New REST API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/orchestrator/containers/:id/logs` | Container crash logs |
| `GET /api/orchestrator/incidents/:id` | Full incident detail |
| `GET /api/orchestrator/remediations/:id` | Full remediation detail |
| `GET /api/orchestrator/metrics` | Platform analytics |
| `GET /api/orchestrator/exclusions` | List exclusions |
| `POST /api/orchestrator/exclusions` | Add runtime exclusion |
| `DELETE /api/orchestrator/exclusions/:name` | Remove exclusion |
| `GET /api/docs` | Swagger/OpenAPI documentation |
