<div align="center">

```
 █████╗ ███████╗ ██████╗ ██╗███████╗
██╔══██╗██╔════╝██╔════╝ ██║██╔════╝
███████║█████╗  ██║  ███╗██║███████╗
██╔══██║██╔══╝  ██║   ██║██║╚════██║
██║  ██║███████╗╚██████╔╝██║███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝
```

### Air-Gapped AIOps & Self-Healing Infrastructure

*Closed-loop - Local-first - Self-healing*

---

[![NestJS](https://img.shields.io/badge/NestJS-11-ea2845?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Kafka](https://img.shields.io/badge/Kafka-KRaft-231f20?style=for-the-badge&logo=apachekafka&logoColor=white)](https://kafka.apache.org/)
[![Python](https://img.shields.io/badge/Python-3.10-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Engine-2496ed?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Local-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)

</div>

---

## What is Aegis?

> **Aegis** is a closed-loop, local-first SRE platform built around Docker event capture, Kafka streaming, and AI-assisted remediation.

The orchestration stack runs entirely on-prem — no cloud, no telemetry, no external dependencies. The NestJS control plane watches container events, publishes typed Kafka messages, stores audit and incident data in MongoDB, and coordinates deterministic remediation workflows locally. A Python AI engine handles classification and diagnosis offline.

---

## Core Capabilities

| Capability | Description |
|---|---|
| Container Watching | Tracks Docker container lifecycle and crash events in real time |
| Kafka Event Bus | Publishes typed events across incident, log, diagnosis, remediation, and audit topics |
| Health Monitoring | Tracks Kafka producer and consumer health for operator visibility |
| Durable Storage | MongoDB persists plans, services, episodes, and replay history |
| Headless Relay | Structured backend events stay within the control plane and Kafka pipeline |
| AI Engine | Python-based offline training, diagnosis, and classification |
| Chaos Testing | Built-in demo crash service for local simulation |

---

## Architecture

```mermaid
graph TD
    Docker[Docker Daemon Events]
    Backend[NestJS Orchestrator]
    Kafka[(Kafka KRaft Cluster)]
    Mongo[(MongoDB)]
    AI[Python AI Engine]
    Crash[demo-crash-service]
    CLI[Aegis CLI]

    Crash --> Docker
    Docker --> Backend
    Backend --> Kafka
    Backend --> Mongo
    Kafka --> Backend
    Backend --> AI
    CLI --> Backend
```

---

## Deep Architecture Flow

```mermaid
graph TD
    subgraph Edge Environment [Local Docker Network]
        DockerSocket[Docker Daemon Socket]
        BrokenService[Failing Microservice Container]
    end

    subgraph The Orchestrator [NestJS Container]
        Watcher[Docker Watchman]
        Orchestrator[Orchestrator Pipeline]
        Executor[Remediation via Dockerode]
    end

    subgraph Event Backbone [Kafka KRaft]
        Topics[Kafka Topics]
    end

    subgraph AI Compute [Local Inference]
        AIEngine[Python AI Engine]
    end

    subgraph State [Local Data]
        Mongo[(MongoDB)]
    end

    subgraph CLI_Layer [Terminal]
        AegisCLI[Aegis CLI]
    end

    BrokenService -- "Crash (OOM/Timeout)" --> DockerSocket
    DockerSocket -- "Intercepts Event" --> Watcher
    Watcher -- "Publishes Event" --> Topics
    Topics -- "Triggers Pipeline" --> Orchestrator
    Orchestrator -- "Sends Logs" --> AIEngine
    AIEngine -- "Returns Diagnosis" --> Orchestrator
    Orchestrator -- "Safety Gate" --> Executor
    Executor -- "Restarts Container" --> DockerSocket
    Orchestrator -- "Persists Audit" --> Mongo
    AegisCLI -- "Queries API" --> Orchestrator
```

---

## Tech Stack

### Backend Orchestrator
- **NestJS 11** + TypeScript
- **KafkaJS** — typed event publishing and consuming
- **Dockerode** — Docker event handling and remediation
- **Mongoose + MongoDB** — durable persistence
- **EventEmitter2** — internal decoupled event bus

### Streaming Layer
- **Kafka** in KRaft mode (no ZooKeeper)
- **Kafka UI** — local topic inspection
- Topics: `container`, `incident`, `logs`, `diagnosis`, `remediation`, `audit`

### Python Services
- `services/ai-engine` — offline inference and model training
- `services/rl-engine` — offline reinforcement learning research
- `services/demo-crash-service` — chaos simulation

### Infrastructure
- **Docker Compose** — single-command full-stack
- **KRaft Kafka** — no external ZooKeeper dependency
- Fully **air-gapped** by design

---

## Local Setup

### Prerequisites

```
Docker Engine and Docker Compose
Node.js  >= 20
Python   >= 3.10
```

### Start the Full Stack

```bash
npm run dev:safe
```
*(This starts the infrastructure, waits for Kafka, and runs NestJS)*

Or manually:
```bash
npm run infra:up
npm run wait:kafka
npm run start:dev
```

> Spins up: MongoDB, Kafka, Kafka UI, NestJS backend, AI engine, Demo crash service

### Debugging

Useful commands if Kafka or other services fail:
```bash
docker compose ps
docker logs aegis-kafka --tail=80
nc -zv localhost 9092
```

---

## Access Points

| Service | URL / Address |
|---|---|
| Backend API | `http://localhost:3001` |
| Kafka UI | `http://localhost:8080` |
| MongoDB | `localhost:27017` |
| Kafka Broker | `localhost:9092` |
| AI Engine | `http://localhost:8000` |
| Demo Crash Service | `http://localhost:3000` |

---

## CLI

```bash
aegis doctor                  # Infrastructure health check
aegis status                  # Platform snapshot
aegis stream                  # Stream Kafka telemetry to terminal
aegis chaos <mode>            # Trigger chaos test
                              # modes: oom | timeout | crash | permission | port
```

---

## Health Checks

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/orchestrator/health/kafka
curl http://localhost:8000/health
```

---

## Chaos Testing

```bash
aegis chaos oom         # OOM crash simulation
aegis chaos timeout     # Timeout hang simulation
aegis chaos crash       # General process crash
aegis chaos permission  # Permission denied simulation
aegis chaos port        # Port collision simulation
```

---

## Kafka Event Flow

```
(1) Docker emits a container event
        |
(2) NestJS Watchman detects and extracts logs
        |
(3) Kafka event published to topic
        |
(4) Orchestrator processes event
        |
(5) AI Engine classifies incident
        |
(6) Safety policy evaluates action
        |
(7) Dockerode executes remediation
        |
(8) MongoDB persists audit record
```

---

## MongoDB Ledger

MongoDB stores the complete audit trail:
- **services** — container status and restart counts
- **infrastructure_events** — raw crash logs and exit codes
- **incident_embeddings** — 384-dimensional log embeddings
- **remediation_plans** — AI diagnosis, risk levels, suggested actions
- **action_executions** — remediation outcomes and duration
- **episodes** — RL training replay buffer

---

## AI Engine

The Python AI engine uses:
- **SentenceTransformers** (all-MiniLM-L6-v2) for log embedding
- **MLP classifier** for incident classification
- **FAISS** for similarity search against historical incidents

The engine auto-trains on synthetic data if no pre-trained weights exist.

---

## Safety Policy

```typescript
const safetyPassed =
  confidenceScore >= 0.85 &&
  riskLevel === 'LOW' &&
  suggestedAction === 'RESTART_CONTAINER';
```

Only low-risk, high-confidence actions are executed automatically. All other actions are skipped and flagged for operator review.

---

## Security Model

- No shell command execution — all Docker actions use Dockerode API
- Only 3 allowed actions: RESTART_CONTAINER, STOP_CONTAINER, IGNORE
- Confidence and risk gate prevents low-confidence automated actions
- Internal API endpoints protected by token-based guards
- No cloud AI APIs — everything is local and offline

---

## Troubleshooting

```bash
# Check container status
docker compose ps

# View Kafka logs
docker logs aegis-kafka --tail=80

# Check MongoDB
docker exec aegis-mongodb mongosh --eval "db.adminCommand('ping')"

# Verify Kafka connectivity
nc -zv localhost 9092

# Full infrastructure reset
node scripts/reset-docker-and-rebuild.js
```

---

## Demonstration Workflow

1. Start infrastructure: `npm run dev:safe`
2. Verify health: `aegis doctor`
3. View status: `aegis status`
4. Start Kafka stream: `aegis stream`
5. Trigger chaos: `aegis chaos oom`
6. Watch pipeline complete
7. Verify in MongoDB: `curl http://localhost:3001/api/orchestrator/incidents`
8. Verify remediation: `curl http://localhost:3001/api/orchestrator/remediations`

---

## Future Enhancements

- Operator-focused remediation controls and incident review views
- Expanded RL training and policy evaluation workflows
- Additional service integrations for broader observability coverage

---

## Design Principles

> **Local by default.** Kafka, MongoDB, and the backend all run on your own machine.
> No telemetry. No cloud dependency. No surprises.

- Air-gapped — zero external network requirements at runtime
- Closed-loop — detect, diagnose, remediate, learn, all locally
- Auditable — every action persisted in MongoDB for replay and review
- Modular — each service is independently replaceable

---

# Developed By

## Tushar Kanti Dey

*Full Stack Developer - DevOps Engineer - AI Infrastructure Enthusiast*

Aegis was developed as a final-year B.Tech Computer Science and Engineering capstone project at **Adamas University**.

[![Email](https://img.shields.io/badge/Email-t.k.d.dey2033929837%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:t.k.d.dey2033929837@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-Tusharxhub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Tusharxhub)
[![Portfolio](https://img.shields.io/badge/Portfolio-tushardevx01.tech-0A0A0A?style=for-the-badge&logo=vercel&logoColor=white)](https://www.tushardevx01.tech)
[![Instagram](https://img.shields.io/badge/Instagram-tushardevx01-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/tushardevx01/)
