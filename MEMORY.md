# MEMORY.md

# Project Aegis Memory

This file is the project memory for **Project Aegis**. It records the final architecture decisions, runtime rules, current status, agent responsibilities, validation commands, and definition of done.

Project Aegis is a final-year B.Tech Computer Science and Engineering capstone project by **Tushar Kanti Dey** at **Adamas University**.

---

## 1. Project Identity

**Project Name:** Project Aegis  
**Type:** Autonomous Self-Healing DevOps Platform  
**Runtime Style:** Headless, terminal-native, local-first, Kafka-driven  
**Main Goal:** Detect, diagnose, remediate, and audit Docker container failures automatically.

Aegis is not a frontend project.  
Aegis is not a dashboard project.  
Aegis is not a CRUD app.

It is a backend infrastructure automation platform.

---

## 2. Core Analogy

Aegis is like a self-driving car with a built-in robot mechanic.

In normal software operations, when an app crashes, a human developer or SRE must wake up, inspect logs, understand the failure, and manually restart or fix the service.

Aegis automates that loop.

When a container crashes:

1. Aegis detects the failure.
2. It collects logs and metadata.
3. It streams the event through Kafka.
4. It stores the incident in MongoDB.
5. It asks a local AI engine to diagnose the issue.
6. It validates the diagnosis through a strict policy gate.
7. It performs safe remediation only if approved.
8. It stores the full audit trail.

---

## 3. Final Runtime Architecture

```txt
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

The core loop is:

```txt
Detect → Diagnose → Remediate → Audit
```

---

## 4. Final Architecture Rules

Project Aegis must remain:

```txt
Headless
Terminal-native
Kafka-driven
MongoDB-persistent
Docker-based
Local-first
Secure-by-design
AI-assisted
Production-inspired
```

The project must not include active runtime usage of:

```txt
React
Next.js
Tailwind
Frontend dashboard
WebSocket UI gateway
PostgreSQL
Prisma
Redis
BullMQ
Ollama
OpenAI
Gemini
Claude
Cloud AI APIs
pnpm
yarn
bun
AI-generated shell commands
```

Use:

```txt
npm
NestJS
TypeScript
KafkaJS
Apache Kafka
MongoDB
Mongoose
Dockerode
Python FastAPI
SentenceTransformers
FAISS
Scikit-learn
Docker Compose
Node.js utility scripts
```

---

## 5. Environment Rules

Use only:

```txt
.env
```

Do not create:

```txt
.env.example
```

The root `.env` should contain:

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

Remove obsolete variables:

```txt
REDIS_*
DATABASE_URL
POSTGRES_*
PRISMA_*
OLLAMA_*
NEXT_PUBLIC_*
```

`.env` must be ignored by Git.

---

## 6. Required Docker Services

The only active Docker Compose services should be:

```txt
aegis-mongodb
aegis-kafka
aegis-kafka-ui
aegis-ai-engine
demo-crash-service
```

Do not include:

```txt
aegis-postgres
aegis-redis
aegis-ollama
frontend
nextjs
prisma
```

Required images:

```txt
MongoDB: mongo:7
Kafka: apache/kafka:4.2.1
```

Required ports:

```txt
MongoDB: 27017
Kafka: 9092
Kafka UI: 8080
AI Engine: 8000
Demo Crash Service: 3000
NestJS Backend: 3001
```

MongoDB volumes must be preserved by default.

---

## 7. Target Repository Structure

```txt
project-aegis/
├── AGENTS.md
├── MEMORY.md
├── README.md
├── package.json
├── package-lock.json
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── docker-compose.yml
├── .env
├── .gitignore
│
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── docker/
│   ├── kafka/
│   ├── mongo/
│   ├── ai-agent/
│   ├── orchestrator/
│   ├── health/
│   └── common/
│
├── cli/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── commands/
│       │   ├── doctor.ts
│       │   ├── status.ts
│       │   ├── stream.ts
│       │   └── chaos.ts
│       └── shared/
│
├── services/
│   ├── ai-engine/
│   ├── rl-engine/
│   └── demo-crash-service/
│
├── infrastructure/
│   ├── kafka/
│   └── mongodb/
│
├── scripts/
│   ├── wait-for-kafka.js
│   ├── verify-runtime.js
│   ├── fix-mongodb-port.js
│   └── reset-docker-and-rebuild.js
│
└── docs/
    ├── architecture.md
    ├── security.md
    └── presentation-flow.md
```

Remove or consolidate obsolete paths:

```txt
backend/
src/gateway/
src/queue/
infrastructure/redis/
rl-agent/
services/rl-lab/
```

If reinforcement learning code exists in `rl-agent/` or `services/rl-lab/`, merge it into:

```txt
services/rl-engine/
```

---

## 8. Runtime Agents

### Docker Watchman Agent

Location:

```txt
src/docker/
```

Responsibilities:

- Connect to `/var/run/docker.sock`
- Listen for Docker events
- Detect `die`, `oom`, `restart`, and `health_status: unhealthy`
- Ignore internal Aegis containers
- Extract logs and metadata
- Persist incident evidence
- Publish typed Kafka events
- Recover from Docker event-stream interruption

Ignored containers:

```txt
aegis-mongodb
aegis-kafka
aegis-kafka-ui
aegis-ai-engine
aegis-control-plane
```

Primary monitored service:

```txt
demo-crash-service
```

---

### Kafka Agent

Location:

```txt
src/kafka/
```

Responsibilities:

- Produce typed events
- Consume diagnosis and remediation events
- Maintain producer and consumer health
- Recover consumers after Kafka outages
- Restore subscriptions after reconnect
- Use idempotent producer settings
- Use string-safe headers and timestamps
- Avoid duplicate subscriptions and event handlers

Kafka timestamp rule:

```ts
timestamp: Date.now().toString()
```

Do not use ISO timestamp strings as KafkaJS message timestamps.

Kafka event envelope:

```ts
export type AegisEvent<T> = {
  eventId: string;
  eventType: string;
  source: string;
  timestamp: string;
  correlationId: string;
  payload: T;
};
```

Required topics:

```txt
aegis.container.events
aegis.logs.extracted
aegis.ai.diagnosis.requested
aegis.ai.diagnosis.completed
aegis.remediation.requested
aegis.remediation.completed
aegis.audit.events
```

Consumer health states:

```txt
CONNECTED
CONNECTING
RESTARTING
DEGRADED
DISCONNECTED
STOPPING
```

---

### MongoDB Persistence Agent

Location:

```txt
src/mongo/
```

Responsibilities:

- Store services
- Store incidents
- Store logs
- Store AI diagnoses
- Store remediation plans
- Store execution results
- Store embeddings
- Store audit events
- Store Kafka outbox records

MongoDB is the source of operational truth.

A Kafka failure must never prevent the core incident write.

Preferred order:

```txt
Persist incident
    ↓
Persist outbox event
    ↓
Attempt Kafka publication
    ↓
Mark PUBLISHED on success
    ↓
Keep PENDING on failure
```

---

### AI Diagnosis Agent

Locations:

```txt
src/ai-agent/
services/ai-engine/
```

Responsibilities:

- Accept crash logs
- Sanitize logs
- Preprocess text
- Generate SentenceTransformer embeddings
- Search similar incidents through FAISS
- Classify the incident locally
- Return a structured diagnosis
- Fail safely if unavailable

Supported incident types:

```txt
OOM_KILL
DB_TIMEOUT
PORT_COLLISION
CRASH_LOOP
MEMORY_LEAK
PERMISSION_DENIED
UNKNOWN_FAILURE
```

Expected response:

```json
{
  "incidentType": "OOM_KILL",
  "analysis": "The service likely ran out of memory.",
  "confidenceScore": 0.91,
  "riskLevel": "LOW",
  "suggestedAction": "RESTART_CONTAINER",
  "reasoning": "Exit code and logs indicate an OOM condition.",
  "similarIncidents": []
}
```

Fallback response:

```json
{
  "incidentType": "UNKNOWN_FAILURE",
  "analysis": "Inference pipeline unavailable.",
  "confidenceScore": 0,
  "riskLevel": "HIGH",
  "suggestedAction": "IGNORE",
  "reasoning": "AI engine is offline or unreachable.",
  "similarIncidents": []
}
```

Fallback must be persisted as degraded operation and must never trigger automatic remediation.

---

### Safety Policy Agent

Location:

```txt
src/orchestrator/
```

Automatic remediation is allowed only when:

```ts
confidenceScore >= 0.85 &&
riskLevel === 'LOW' &&
suggestedAction === 'RESTART_CONTAINER'
```

Allowed actions:

```txt
RESTART_CONTAINER
STOP_CONTAINER
IGNORE
```

The policy agent must reject:

- Unknown action values
- Low-confidence decisions
- Medium-risk decisions
- High-risk decisions
- AI fallback decisions
- Internal Aegis container targets
- Duplicate remediation attempts

---

### Remediation Agent

Locations:

```txt
src/orchestrator/
src/docker/
```

Required execution path:

```txt
Orchestrator
    ↓
Safety policy
    ↓
Approved enum action
    ↓
DockerService
    ↓
Dockerode API
```

The remediation agent must not:

- Use `child_process`
- Execute AI-generated commands
- Execute shell strings
- Restart internal Aegis containers automatically
- Hide failed remediation attempts

---

### CLI Agent

Location:

```txt
cli/
```

Required commands:

```bash
aegis doctor
aegis status
aegis stream
aegis chaos crash
aegis chaos oom
aegis chaos timeout
aegis chaos permission
aegis chaos port
```

The global CLI must execute compiled JavaScript.

Required package configuration:

```json
{
  "bin": {
    "aegis": "./dist/cli/index.js"
  }
}
```

The CLI entry must start with:

```ts
#!/usr/bin/env node
```

Do not use `ts-node` for the globally linked CLI.

---

## 9. Offline RL Engine

Location:

```txt
services/rl-engine/
```

The RL engine is an offline research component.

It may:

- Read historical incidents
- Build replay datasets
- Train candidate policies
- Evaluate remediation policies
- Generate metrics
- Export research models

It must not:

- Access the Docker socket
- Restart or stop containers
- Bypass the NestJS policy engine
- Control live infrastructure
- Write directly to live remediation topics

Live remediation must remain deterministic and policy-gated.

---

## 10. Required API Endpoints

Expected backend routes:

```txt
GET  /
GET  /api/health
GET  /api/orchestrator/health/kafka
GET  /api/orchestrator/containers
GET  /api/orchestrator/containers/:id
POST /api/orchestrator/containers/:id/restart
GET  /api/orchestrator/incidents
GET  /api/orchestrator/remediations
```

`incidents` and `remediations` must return real MongoDB data.

Example response:

```json
{
  "status": "ok",
  "count": 0,
  "data": []
}
```

Do not return fake records.

---

## 11. Demo Crash Service

Location:

```txt
services/demo-crash-service/server.js
```

Required routes:

```txt
GET /
GET /health
GET /crash
GET /crash/oom
GET /crash/timeout
GET /crash/permission
GET /crash/port
```

Expected behavior:

```txt
/                 → service metadata JSON
/health           → healthy response
/crash            → deliberate process termination
/crash/oom        → controlled OOM simulation or exit code 137
/crash/timeout    → delayed or hanging request
/crash/permission → EACCES-style failure
/crash/port       → EADDRINUSE-style failure
```

Chaos routes must create useful logs before failure.

---

## 12. Node.js Utility Scripts

Use only Node.js utility scripts.

Required files:

```txt
scripts/wait-for-kafka.js
scripts/verify-runtime.js
scripts/fix-mongodb-port.js
scripts/reset-docker-and-rebuild.js
```

Do not create `.sh` runtime scripts.

Script behavior:

- Cross-platform where practical
- Safe defaults
- Clear logs
- Meaningful exit codes
- No automatic Docker volume deletion
- Explicit confirmation for destructive operations

---

## 13. Required package.json Scripts

Root `package.json` should include:

```json
{
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "build:cli": "tsc -p cli/tsconfig.json",
    "cli": "node dist/cli/index.js",
    "infra:up": "docker compose up -d --build",
    "infra:down": "docker compose down",
    "wait:kafka": "node scripts/wait-for-kafka.js",
    "verify": "node scripts/verify-runtime.js",
    "fix:mongo-port": "node scripts/fix-mongodb-port.js",
    "reset:docker": "node scripts/reset-docker-and-rebuild.js",
    "dev:safe": "npm run infra:up && npm run wait:kafka && npm run start:dev"
  },
  "bin": {
    "aegis": "./dist/cli/index.js"
  }
}
```

Use npm only.

---

## 14. Security Boundaries

Mandatory rules:

- No external AI APIs
- No cloud inference
- No shell remediation
- No AI-generated command execution
- No direct RL control of Docker
- No automatic high-risk action
- No remediation below threshold
- No secret values in logs
- `.env` ignored by Git
- Docker socket documented as privileged
- Internal containers excluded from monitoring
- All actions mapped to allowlisted Dockerode methods
- Logs sanitized before AI processing
- API query limits bounded
- Errors normalized before persistence
- No unbounded embedding or log output

---

## 15. Documentation Requirements

Main documentation files:

```txt
README.md
AGENTS.md
MEMORY.md
docs/architecture.md
docs/security.md
docs/presentation-flow.md
```

README must preserve:

- Aegis ASCII heading
- Centered intro
- Badges
- Conceptual analogy
- Core capabilities
- Both Mermaid architecture diagrams
- Setup instructions
- CLI section
- Health checks
- Chaos testing flow
- Kafka lifecycle
- MongoDB ledger
- AI engine
- Safety policy
- Security model
- Troubleshooting
- Demonstration workflow
- Future scope
- Developer section

Do not show Redis or BullMQ in the final diagrams unless they are actually active and tested.

Document RL as an offline research component.

---

## 16. Current Known Status

The project has already reached a working state in these areas:

```txt
NestJS compiled with 0 errors
MongoDB connected successfully
Kafka producer connected
Kafka consumers connected
Docker daemon reachable
Docker Watchman active
Aegis control plane online
CLI chaos command can trigger demo crash service
Kafka image corrected to apache/kafka:4.2.1
MongoDB uses mongo:7
```

Known issues that must be handled or verified:

```txt
AI engine must be running for self-healing to work
Kafka consumer must auto-recover after broker outage
Kafka failures must not block MongoDB writes
MongoDB-backed Kafka outbox should preserve pending events
CLI global command must avoid ts-node production warnings
README must not mention Redis/BullMQ as active runtime
RL must remain offline research only
```

---

## 17. Validation Commands

Baseline validation:

```bash
npm install
npm run build
npm run build:cli
npm run infra:up
npm run wait:kafka
npm run verify
```

Start backend:

```bash
npm run start:dev
```

CLI validation:

```bash
npm link
aegis doctor
aegis status
aegis stream
```

API validation:

```bash
curl http://localhost:3001/
curl http://localhost:3001/api/health
curl http://localhost:3001/api/orchestrator/health/kafka
curl http://localhost:3001/api/orchestrator/containers
curl http://localhost:3001/api/orchestrator/incidents
curl http://localhost:3001/api/orchestrator/remediations
curl http://localhost:8000/health
curl http://localhost:3000/health
```

Docker validation:

```bash
docker compose ps
```

---

## 18. Required Outage Tests

### Kafka outage test

```bash
docker compose stop aegis-kafka
docker compose up -d demo-crash-service
aegis chaos crash
docker compose start aegis-kafka
```

Expected:

```txt
Incident stored in MongoDB
Kafka event stored in outbox
Kafka health marked degraded
Consumer supervisor enters restart mode
No MongoDB write is blocked
Kafka recovers
Consumers reconnect
Pending outbox events publish
Health returns to healthy
```

### AI outage test

```bash
docker compose stop aegis-ai-engine
docker compose up -d demo-crash-service
aegis chaos crash
docker compose start aegis-ai-engine
```

Expected:

```txt
Incident stored
Fallback diagnosis persisted
AI state marked degraded
Remediation skipped
Incident marked for operator review
Backend remains online
AI health recovers
```

### End-to-end chaos test

```bash
docker compose up -d demo-crash-service
aegis chaos oom
```

Expected:

```txt
Chaos endpoint invoked
Container failure emitted
Watchman detected event
Logs extracted
Incident persisted
Kafka event published or queued
AI diagnosis completed
Safety policy evaluated
Safe remediation executed or skipped
Execution result persisted
Audit trail completed
CLI and APIs show the incident
```

---

## 19. Definition of Done

The project is complete only when:

```txt
npm install succeeds
NestJS build succeeds
CLI build succeeds
Docker Compose services become healthy
MongoDB connects
Kafka connects
Kafka consumers recover after outage
Kafka outbox retries pending events
AI engine responds
AI fallback behaves safely
Docker Watchman detects failures
Demo crash routes work
Incidents persist
Diagnoses persist
Policy decisions persist
Remediation results persist
CLI doctor works
CLI status works
CLI stream works
All chaos modes work
Required APIs return real data
Graceful shutdown works
README matches the implementation
AGENTS.md matches the implementation
MEMORY.md matches the implementation
No Redis remains
No BullMQ remains
No PostgreSQL remains
No Prisma remains
No Ollama remains
No frontend remains
No cloud AI remains
No production CLI ts-node warning remains
```

A safe skipped remediation is better than an unsafe action.

Do not weaken policy rules to make tests pass.

---

## 20. Developer Details

```md
# 👨‍💻 Developed By

## Tushar Kanti Dey

*Full Stack Developer · DevOps Engineer · AI Infrastructure Enthusiast*

Aegis was developed as a final-year B.Tech Computer Science and Engineering capstone project at **Adamas University**.

[![Email](https://img.shields.io/badge/Email-t.k.d.dey2033929837%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:t.k.d.dey2033929837@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-Tusharxhub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Tusharxhub)
[![Portfolio](https://img.shields.io/badge/Portfolio-tushardevx01.tech-0A0A0A?style=for-the-badge&logo=vercel&logoColor=white)](https://www.tushardevx01.tech)
[![Instagram](https://img.shields.io/badge/Instagram-tushardevx01-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/tushardevx01/)
```

---

## 21. Agent Decision Hierarchy

When multiple actions are possible, follow this priority:

```txt
1. Preserve host safety
2. Preserve auditability
3. Preserve incident evidence
4. Keep control plane available
5. Restore event delivery
6. Restore AI diagnosis
7. Perform safe remediation
8. Optimize performance
```

Never trade safety for a successful-looking demo.
