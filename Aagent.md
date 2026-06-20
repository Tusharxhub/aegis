# AGENTS.md

# Project Aegis Agent Guide

This document explains how AI agents operate inside **Project Aegis** and defines the rules that coding agents must follow when modifying the repository.

Project Aegis is a local-first, headless, Kafka-driven, autonomous self-healing DevOps platform. It monitors Docker workloads, detects failures, diagnoses incidents through a local AI engine, applies deterministic safety policies, executes approved remediation through Dockerode, and stores a complete audit trail in MongoDB.

---

## 1. Core Principle

Aegis uses AI to assist diagnosis, not to control infrastructure without limits.

The runtime loop is:

```txt
Detect
  ↓
Collect evidence
  ↓
Publish event
  ↓
Persist incident
  ↓
Diagnose
  ↓
Validate policy
  ↓
Execute approved action
  ↓
Audit result
```

The AI agent is advisory. The NestJS policy engine remains the final authority.

---

## 2. Final Runtime Architecture

```txt
Docker container failure
        ↓
Docker Watchman
        ↓
Log extraction and event normalization
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

The live runtime uses:

- NestJS
- TypeScript
- KafkaJS
- Apache Kafka in KRaft mode
- MongoDB and Mongoose
- Dockerode
- Python FastAPI
- SentenceTransformers
- FAISS
- Scikit-learn
- Node.js CLI
- Docker Compose

The live runtime does not use:

- React
- Next.js
- Frontend dashboards
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Ollama
- Cloud AI APIs
- AI-generated shell commands

---

## 3. Runtime Agents

Aegis is composed of several specialized agents. Each agent has a narrow responsibility.

### 3.1 Watchman Agent

Location:

```txt
src/docker/
```

Responsibilities:

- Connect to `/var/run/docker.sock`
- Listen for Docker lifecycle events
- Detect `die`, `oom`, restart, and unhealthy events
- Ignore internal Aegis infrastructure containers
- Extract the final container logs
- Normalize container metadata
- create incident evidence
- forward events to the orchestrator

The Watchman must not:

- Execute arbitrary shell commands
- Monitor Aegis infrastructure recursively
- Restart containers without policy approval
- Lose an incident because Kafka is unavailable

Ignored containers include:

```txt
aegis-mongodb
aegis-kafka
aegis-kafka-ui
aegis-ai-engine
aegis-control-plane
```

Primary monitored target:

```txt
demo-crash-service
```

---

### 3.2 Event Streaming Agent

Location:

```txt
src/kafka/
```

Responsibilities:

- Publish typed Aegis events
- Consume diagnosis and remediation events
- Maintain Kafka producer and consumer health
- Recover consumers after broker outages
- Restore subscriptions after reconnection
- Preserve event ordering where required
- Avoid duplicate publication through stable event identifiers

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

Kafka message timestamps must be millisecond strings:

```ts
timestamp: Date.now().toString()
```

ISO timestamps may be stored inside the JSON payload.

The Kafka agent must implement:

- Idempotent producer configuration
- Consumer restart supervision
- Exponential backoff
- Jitter
- Graceful shutdown
- Accurate health states
- No duplicate subscriptions
- No permanent consumer death after a temporary outage

Suggested health states:

```txt
CONNECTED
CONNECTING
RESTARTING
DEGRADED
DISCONNECTED
STOPPING
```

---

### 3.3 Persistence Agent

Location:

```txt
src/mongo/
```

Responsibilities:

- Store services
- Store incidents
- Store raw evidence and logs
- Store AI diagnoses
- Store remediation plans
- Store execution results
- Store audit events
- Store pending Kafka outbox records
- Preserve data during partial infrastructure failure

MongoDB is the source of operational truth.

A Kafka failure must never block the core MongoDB incident write.

Preferred failure order:

```txt
Persist incident
    ↓
Store outbox event
    ↓
Attempt Kafka publication
    ↓
Mark published or keep pending
```

The persistence agent must not:

- Depend on Kafka availability to save incidents
- Delete failed outbox events silently
- Use untyped Mongoose models where proper schemas are possible
- Expose credentials through API responses

---

### 3.4 AI Diagnosis Agent

Locations:

```txt
src/ai-agent/
services/ai-engine/
```

The NestJS AI client handles communication. The Python AI engine performs local diagnosis.

Responsibilities:

- Accept normalized crash logs
- Sanitize and preprocess text
- Generate embeddings
- Search similar incidents through FAISS
- Classify the incident
- Return a structured diagnosis
- Expose health information
- Fail safely when unavailable

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

Expected response contract:

```ts
export type IncidentType =
  | 'OOM_KILL'
  | 'DB_TIMEOUT'
  | 'PORT_COLLISION'
  | 'CRASH_LOOP'
  | 'MEMORY_LEAK'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN_FAILURE';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type SuggestedAction =
  | 'RESTART_CONTAINER'
  | 'STOP_CONTAINER'
  | 'IGNORE';

export interface AiDiagnosisResponse {
  incidentType: IncidentType;
  analysis: string;
  confidenceScore: number;
  riskLevel: RiskLevel;
  suggestedAction: SuggestedAction;
  reasoning: string;
  similarIncidents: unknown[];
}
```

Safe fallback when the AI engine is unreachable:

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

Fallback output must be persisted as degraded operation, not reported as a successful diagnosis.

---

### 3.5 Safety Policy Agent

Location:

```txt
src/orchestrator/
```

Responsibilities:

- Validate diagnosis confidence
- Validate risk level
- Validate requested action
- Enforce an allowlist of remediation actions
- Reject unsafe or uncertain decisions
- Mark incidents for operator review
- Produce an auditable decision

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

The policy agent must never allow:

- Raw shell commands
- AI-generated scripts
- Dynamic command execution
- Privileged container creation
- File deletion commands
- Safety-threshold bypass
- Automatic high-risk actions

---

### 3.6 Remediation Agent

Locations:

```txt
src/orchestrator/
src/docker/
```

Responsibilities:

- Receive only policy-approved action enums
- Map actions to hardcoded Dockerode methods
- Restart approved containers
- Record execution duration and result
- Handle Docker API failures
- Prevent duplicate remediation for the same incident

Required execution path:

```txt
Orchestrator
    ↓
Safety policy
    ↓
Approved action enum
    ↓
DockerService
    ↓
Dockerode API
```

There must be only one live remediation path.

The remediation agent must not:

- Use `child_process` for live remediation
- Execute command strings returned by AI
- Restart internal Aegis containers automatically
- Hide failed remediation attempts

---

### 3.7 Audit Agent

Location:

```txt
src/mongo/
src/orchestrator/
```

Responsibilities:

- Record every major lifecycle transition
- Preserve correlation IDs
- Store diagnosis and policy decisions
- Store remediation outcomes
- Store degraded-mode activity
- Support incident review and replay

Every incident should be traceable through:

```txt
eventId
correlationId
containerId
containerName
incidentId
diagnosisId
remediationPlanId
executionId
timestamps
```

---

### 3.8 CLI Agent

Location:

```txt
cli/
```

Responsibilities:

- Provide terminal-native control
- Verify runtime health
- Display status
- Stream Kafka events
- Trigger controlled chaos scenarios
- Explain expected failures clearly

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

The globally linked CLI must run compiled JavaScript.

Do not use `ts-node` for production CLI execution.

Required binary configuration:

```json
{
  "bin": {
    "aegis": "./dist/cli/index.js"
  }
}
```

The CLI entry file must start with:

```ts
#!/usr/bin/env node
```

---

## 4. Offline Reinforcement Learning Agent

Location:

```txt
services/rl-engine/
```

The RL engine is a research component. It is not part of the live remediation authority.

It may:

- Read historical incidents
- Build replay datasets
- Train candidate policies
- Evaluate policy performance
- Generate metrics
- Compare reward functions
- Export candidate models for offline review

It must not:

- Access the Docker socket
- Restart or stop containers
- Bypass the NestJS policy engine
- Write directly to live remediation topics
- Control production infrastructure

Live remediation remains deterministic.

---

## 5. Agent Communication Contracts

All cross-service communication must use typed, validated contracts.

Required properties:

- Stable event IDs
- Correlation IDs
- ISO timestamps in payloads
- Millisecond Kafka message timestamps
- Validated enums
- JSON-safe payloads
- No BigInt values in JSON
- No raw Error objects in events
- No secrets in logs or messages

Normalize errors before persistence:

```ts
type NormalizedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
};
```

---

## 6. Failure Isolation Rules

Aegis must continue operating in degraded mode when one dependency fails.

### Kafka unavailable

Expected behavior:

- Save incident to MongoDB
- Store event in MongoDB outbox
- Mark Kafka status degraded
- Restart consumers automatically
- Retry pending events after recovery
- Do not lose evidence

### AI engine unavailable

Expected behavior:

- Save incident
- Persist safe fallback diagnosis
- Mark incident for operator review
- Skip automatic remediation
- Report AI status as degraded
- Continue monitoring other containers

### MongoDB unavailable

Expected behavior:

- Do not execute remediation without an audit path
- Report the control plane as degraded
- Retry connection
- Avoid pretending the incident was persisted
- Preserve in-memory context only as a temporary measure

### Docker unavailable

Expected behavior:

- Stop monitoring and remediation
- Keep APIs alive when possible
- Report Docker health as unavailable
- Retry connection safely
- Do not execute fallback shell commands

---

## 7. Durable Kafka Outbox

Aegis should use a MongoDB-backed outbox to avoid event loss.

Suggested schema:

```ts
type OutboxEvent = {
  eventId: string;
  topic: string;
  key?: string;
  payload: unknown;
  headers?: Record<string, string>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  publishedAt?: Date;
};
```

Required behavior:

1. Persist the outbox record before publishing.
2. Publish to Kafka.
3. Mark `PUBLISHED` after broker acknowledgement.
4. Keep `PENDING` after temporary failure.
5. Retry with bounded batches.
6. Use backoff.
7. Prevent concurrent duplicate publication.
8. Keep the same `eventId`.
9. Never silently delete failed records.

---

## 8. Security Boundaries

The following rules are mandatory:

- No external AI API keys
- No cloud inference
- No AI-generated shell commands
- No arbitrary command execution
- No direct RL control of Docker
- No automatic high-risk action
- No remediation below the confidence threshold
- No secret values in logs
- `.env` must remain ignored by Git
- Docker socket access must be documented as privileged
- Internal Aegis services must be excluded from Watchman
- All remediation must use allowlisted Dockerode methods

---

## 9. Repository Rules for Coding Agents

Any coding agent modifying this repository must follow these instructions.

### Preserve working systems

Do not rewrite stable modules without a verified reason.

Working areas include:

```txt
NestJS bootstrap
Docker Watchman
Kafka producer and consumer foundation
MongoDB schemas and connection
AI HTTP client
Orchestrator pipeline
Audit service
Python AI engine
CLI chaos and stream commands
Docker Compose core services
```

### Inspect before editing

Before changing a file:

1. Read the existing implementation.
2. Search all imports and usages.
3. Identify runtime dependencies.
4. Confirm the change does not duplicate existing logic.
5. Make the smallest correct change.

### Do not introduce

```txt
React
Next.js
Frontend code
Redis
BullMQ
PostgreSQL
Prisma
Ollama
Cloud AI APIs
pnpm
yarn
bun
Shell-based remediation
```

Use npm only.

### Environment files

Use only:

```txt
.env
```

Do not create:

```txt
.env.example
```

### Scripts

Use cross-platform Node.js utilities:

```txt
scripts/wait-for-kafka.js
scripts/verify-runtime.js
scripts/fix-mongodb-port.js
scripts/reset-docker-and-rebuild.js
```

Do not add new `.sh` runtime scripts.

### Documentation

Keep documentation aligned with implemented behavior.

Do not claim:

- Features that are not implemented
- Redis or BullMQ runtime usage
- Direct RL remediation
- Production readiness without test evidence
- Exactly-once behavior without transactional verification

Preserve both Mermaid architecture diagrams in the main README.

---

## 10. Coding Standards

### TypeScript

- Strict TypeScript
- No unnecessary `any`
- Prefer explicit interfaces
- Validate external input
- Keep modules focused
- Use dependency injection
- Normalize errors
- Handle promise rejection
- Add graceful shutdown
- Avoid duplicate retry loops

### Python

- Use type hints
- Use Pydantic request and response models
- Keep inference deterministic where practical
- Validate model availability
- Handle missing model files safely
- Do not download models during runtime unless explicitly documented
- Keep health checks lightweight

### Logging

Use clear component prefixes:

```txt
[AEGIS]
[DOCKER]
[KAFKA]
[MONGO]
[AI]
[POLICY]
[REMEDIATION]
[AUDIT]
[CLI]
```

Do not log:

- Secrets
- Full environment variables
- Raw credentials
- Excessively large embeddings
- Unbounded container logs

---

## 11. Required Health Checks

The platform should expose or verify:

```txt
Docker daemon
MongoDB
Kafka producer
Kafka consumers
Kafka recovery state
Kafka outbox
AI engine
Demo crash service
NestJS backend
```

Expected endpoints:

```txt
GET /
GET /api/health
GET /api/orchestrator/health/kafka
GET /api/orchestrator/containers
GET /api/orchestrator/containers/:id
POST /api/orchestrator/containers/:id/restart
GET /api/orchestrator/incidents
GET /api/orchestrator/remediations
```

---

## 12. Required Validation

Before declaring a task complete, coding agents must run the relevant checks.

Baseline:

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

CLI:

```bash
npm link
aegis doctor
aegis status
```

End-to-end chaos test:

```bash
docker compose up -d demo-crash-service
aegis chaos oom
```

Verify:

```txt
Crash endpoint invoked
Container failure emitted
Watchman detected event
Logs extracted
Incident persisted
Kafka event published or queued in outbox
AI diagnosis returned or safe fallback persisted
Safety policy evaluated
Remediation executed or safely skipped
Audit result persisted
```

Kafka outage test:

```bash
docker compose stop aegis-kafka
aegis chaos crash
docker compose start aegis-kafka
```

Confirm:

- Incident remains in MongoDB
- Event remains pending
- Consumer reconnects
- Event is eventually published
- Health returns to healthy

AI outage test:

```bash
docker compose stop aegis-ai-engine
aegis chaos crash
docker compose start aegis-ai-engine
```

Confirm:

- Incident is stored
- Fallback diagnosis is persisted
- Automatic remediation is skipped
- AI health recovers

---

## 13. Definition of Done

A change is complete only when:

- TypeScript build passes
- CLI build passes
- No broken imports remain
- No dead code is introduced
- Relevant health checks pass
- Failure handling is tested
- Documentation matches behavior
- Security boundaries remain intact
- The implementation does not depend on removed architecture
- The final report states what was verified and what remains uncertain

Do not claim success without validation evidence.

---

## 14. Agent Decision Hierarchy

When multiple actions are possible, agents must follow this priority:

```txt
1. Preserve human safety and host integrity
2. Preserve auditability
3. Preserve incident evidence
4. Keep the control plane available
5. Restore event delivery
6. Restore AI diagnosis
7. Perform safe remediation
8. Optimize performance
```

Aegis must prefer a safe skipped remediation over an unsafe automatic action.