# Project Aegis 🛡️
### Autonomous Self-Healing Infrastructure Platform

> Air-gapped · Local-first · No cloud dependencies · Zero shell injection

Aegis is an autonomous DevOps self-healing infrastructure platform. It monitors container status via the Docker UNIX socket, embeds crash logs using a local SentenceTransformer, and makes healing decisions via a custom Multi-Layer Perceptron (MLP) neural network classifier — running 100% on your own CPU/GPU hardware.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Services](#core-services)
- [Port Directory](#port-directory)
- [Quick Start](#quick-start)
- [SRE Orchestrator (NestJS)](#sre-orchestrator-nestjs)
- [ML Pipeline (Python AI Engine)](#ml-pipeline-python-ai-engine)
- [Relational Audit Store (PostgreSQL)](#relational-audit-store-postgresql)
- [Security Model](#security-model)

---

## Architecture Overview

```
[Container Crash] ──> Watchman Interceptor ──> NestJS (BullMQ Queue)
                                                       │
   PostgreSQL Audit Store <── [Safe Remediation] <─────┼──> [Python AI Engine]
                                                       │         ├── SentenceTransformer
                                                       │         ├── FAISS Vector Store
                                                       │         └── MLP Classifier
                                                       ▼
                                            [Next.js 15 Web Console]
```

**Incident lifecycle — step by step:**

1. A target container crashes and emits a `die` event on `/var/run/docker.sock`
2. **Watchman** intercepts the event, tails the last 100 lines of stdout/stderr, and enqueues a BullMQ job in Redis
3. The **AI Client** POSTs the raw log text to `http://aegis-ai-engine:8000/diagnose`
4. The **AI Engine** preprocesses the text, embeds it via `all-MiniLM-L6-v2`, and runs dual-branch inference (FAISS similarity search + MLP classification)
5. The **Safety Gate** validates `confidenceScore > 0.85` AND `riskLevel === 'LOW'` before any automated action
6. If gates pass, a hardcoded `dockerode` API call executes the action enum — no shell commands ever run
7. The full incident is audited to PostgreSQL and broadcast over Socket.io to the web console

---

## Core Services

| Service | Technology | Responsibility |
|---|---|---|
| **Watchman** | NestJS + dockerode | Subscribes to Docker event stream, filters `container.die`, pulls logs |
| **Task Queue** | BullMQ + Redis | Decouples socket watcher from AI classification; persists jobs across restarts |
| **AI Client** | NestJS HTTP module | Compiles crash text, calls `/diagnose`, validates schema, stores embeddings |
| **Safe Remediation** | NestJS + dockerode | Evaluates safety gates, maps action enum to native Docker API calls |
| **WebSocket Gateway** | Socket.io (port 3001) | Broadcasts `incident.detected`, `ai.analysis.completed`, `remediation.completed` |
| **AI Engine** | FastAPI + Python | SentenceTransformer embedding + FAISS search + MLP classification |
| **Web Console** | Next.js 15 | Real-time dashboard for monitoring, approvals, and manual retraining |

---

## Port Directory

| Service | Port | Protocol | Host Exposure |
|---|---|---|---|
| Next.js Web Console | `3000` | HTTP | ✅ Public |
| NestJS Orchestrator | `3001` | HTTP / WebSocket | ✅ Public |
| Python AI Engine | `8000` | HTTP JSON | 🔒 Internal only |
| Redis Cache | `6379` | TCP | 🔒 Internal only |
| PostgreSQL | `5432` | TCP | 🔒 Internal only |

Redis, PostgreSQL, and the AI Engine are accessible only within the `aegis-network` container bridge — they are never exposed to the host.

---

## Quick Start

### Prerequisites

- Docker Engine & Docker Compose
- Node.js 20+ *(optional — only for local development outside containers)*
- Python 3.10+ *(optional — only for local model tweaking)*

---

### Step 1 — Clone and configure environment

Create a `.env` file in the root directory:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aegis"
```

---

### Step 2 — Build and launch the cluster

```bash
docker compose up --build -d
```

> **Zero-configuration boot:** On startup, `aegis-ai-engine` detects if local models are missing and automatically runs the synthetic data generation and classifier training scripts — generating 900 training samples, fitting the SentenceTransformer, and serialising both model artefacts before passing its Docker health check.

---

### Step 3 — Apply database migrations

```bash
docker exec -it aegis-nestjs npx prisma db push
```

---

### Step 4 — Verify system health

```bash
curl http://localhost:8000/health
```

**Expected response:**

```json
{
  "status": "healthy",
  "loaded_models": {
    "sentence_transformer": true,
    "classifier_head": true,
    "vector_store": true
  }
}
```

---

### Manual model retraining

To force-retrain the MLP classifier on local CPU without restarting the cluster:

1. Open the web console at [http://localhost:3000](http://localhost:3000)
2. Click **"Trigger Manual Training"**
3. NestJS calls the AI engine's retrain endpoint and hot-swaps the new model weights in-process

---

## SRE Orchestrator (NestJS)

The orchestrator is composed of five NestJS modules coordinated via dependency injection, each owning one responsibility in the incident lifecycle.

### 1. Watchman — Docker socket watcher

- **Connection:** Mounted to `/var/run/docker.sock` via `dockerode`
- **Subscription:** Raw Docker daemon event stream, filtered for `container.die` events
- **Log pull:** Tails the last 100 lines of multiplexed stdout/stderr buffers on crash intercept
- **Output:** Enqueues a BullMQ job payload containing container metadata and raw log text

### 2. Task Queue — BullMQ & Redis

- **Engine:** Redis-backed BullMQ queue provider
- **Purpose:** Decouples the low-latency socket watcher from the high-overhead AI classification call
- **Persistence:** Jobs survive NestJS container restarts — no incident data is lost if the orchestrator crashes mid-remediation

### 3. AI Client Coordinator

- **Input:** Destructures BullMQ job payload and compiles raw error text
- **Call:** `POST http://aegis-ai-engine:8000/diagnose`
- **Validation:** Validates response against a strict contract schema
- **Storage:** Logs the returned 384-dimensional SentenceTransformer vector embedding to PostgreSQL

### 4. Safe Remediation Engine

The AI never generates or runs raw shell commands. It returns a typed action enum from a fixed registry. The NestJS engine maps that enum programmatically to hardcoded `dockerode` API calls.

**Safety gate logic:**

```typescript
const isSafetyPassed =
  diagnosis.confidenceScore > 0.85          // MLP certainty threshold
  && diagnosis.riskLevel === 'LOW'           // only RESTART_CONTAINER qualifies
  && diagnosis.suggestedAction !== 'IGNORE';
```

**Risk level mapping:**

| Action | Risk Level | Auto-execute? |
|---|---|---|
| `RESTART_CONTAINER` | `LOW` | ✅ Yes, if confidence > 0.85 |
| `STOP_CONTAINER` | `HIGH` | ❌ Requires human approval via console |
| `IGNORE` | — | ❌ Logged only, no execution |

**Fail-safe policy:** If any gate fails, the plan state is set to `SKIPPED`, a Socket.io notification is broadcast, and the container state transitions to `DEGRADED` for operator review.

### 5. Realtime WebSocket Gateway

Socket.io server running on port 3001 emits three lifecycle events:

| Event | Trigger | Payload |
|---|---|---|
| `incident.detected` | Container crash | Container metadata, exit code |
| `ai.analysis.completed` | MLP classification | Diagnosis class, confidence score, risk level, vector |
| `remediation.completed` | Docker API execution | Action taken, outcome, duration metrics |

---

## ML Pipeline (Python AI Engine)

All inference runs locally inside the `aegis-ai-engine` container — no external model API calls at runtime.

### Pipeline diagram

```
[Raw Error Log]
       │
       ▼  Clean timestamps & PID tags
[Preprocessed Text]
       │
       ▼  all-MiniLM-L6-v2 transformer
[384-Dim Embedding Vector]
       │
       ├────────────────────────────────────────┐
       ▼                                        ▼
 FAISS IndexFlatL2                      MLP Classifier
 Top-3 Euclidean matches            6-class probability scores
       │                                        │
       └──────────────────┬─────────────────────┘
                          ▼
               [Diagnose Response]
       action · confidenceScore · riskLevel · similarIncidents
```

---

### Stage 1 — Embedding Generator (SentenceTransformer)

- **Model:** `all-MiniLM-L6-v2` — a lightweight DistilBERT-based model
- **Output:** 384-dimensional dense floating-point vector arrays
- **Storage:** Serialised to `/app/models/sentence_transformer` inside the container
- **Air-gap:** No HuggingFace or external connections at inference time

---

### Stage 2 — Similarity Engine (FAISS)

- **Library:** `faiss-cpu` (Facebook AI Similarity Search)
- **Index type:** `faiss.IndexFlatL2` — exact L2 Euclidean distance matching
- **Distance formula:**

$$d(u, v) = \sqrt{\sum_{i=1}^{n} (u_i - v_i)^2}$$

- **Usage:** Searches local vector memory to surface the top-3 historical incidents with matching semantics, enabling operators to identify recurring failure patterns
- **Persistence:**
  - `/app/vectorstore/storage/faiss_index.bin` — binary vector index weights
  - `/app/vectorstore/storage/metadata.pkl` — pickled metadata mapping index positions to incident IDs, log text, and class labels

---

### Stage 3 — MLP Classification Head

A custom Multilayer Perceptron trained on top of SentenceTransformer embeddings via Scikit-Learn.

**Neural network topology:**

```
Input layer    →  384 neurons   (matches embedding dimension)
Hidden layer 1 →  128 neurons   (ReLU activation + dropout regularisation)
Hidden layer 2 →   64 neurons   (ReLU activation)
Output layer   →    6 neurons   (softmax → crash category probabilities)
```

**Output class mapping:**

| Class | Label | Description |
|---|---|---|
| `0` | `OOM_KILL` | Memory exhaustion — container OOM-killed by kernel |
| `1` | `DB_TIMEOUT` | Database connection failure or pool exhaustion |
| `2` | `PORT_COLLISION` | Address already in use — socket bind failure |
| `3` | `CRASH_LOOP` | Script or runtime ReferenceErrors causing restart loop |
| `4` | `MEMORY_LEAK` | RSS grows linearly without garbage collection |
| `5` | `PERMISSION_DENIED` | File system EACCES permission errors |

---

### Auto-bootstrapping

`main.py` runs this check on every container startup:

1. Check if `/app/models/classifier_head.joblib` exists
2. If missing → invoke the data generation script to build a **900-sample synthetic dataset**
3. Encode all samples via the SentenceTransformer
4. Train the MLP classifier head on the encoded features
5. Serialise both model artefacts to disk
6. Pass the Docker health check — service is ready

This provides a fully zero-configuration developer experience: `docker compose up` is all that is required.

---

## Relational Audit Store (PostgreSQL)

PostgreSQL (interfaced via Prisma ORM) stores the complete incident lifecycle audit trail.

### Entity relationship

```
services ||--o{ infrastructure_events : logs
infrastructure_events ||--o| incident_embeddings : vector
infrastructure_events ||--o| remediation_plans   : diagnostics
remediation_plans     ||--o| action_executions    : results
metrics_snapshots
```

### Table reference

#### `services`
Tracks all monitored container targets.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `string` | Container name |
| `status` | `enum` | `HEALTHY` \| `CRASHED` \| `DEGRADED` |
| `restartCount` | `int` | Cumulative restart counter |

#### `infrastructure_events`
Stores raw crash log blocks per incident.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `serviceId` | `uuid` | FK → `services` |
| `rawLogs` | `text` | Last 100 lines of stdout/stderr |
| `exitCode` | `int` | Docker container exit code |
| `timestamp` | `datetime` | Event capture time |

#### `incident_embeddings`
Stores the SentenceTransformer vector representation of each incident.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `eventId` | `uuid` | FK → `infrastructure_events` |
| `vector` | `Float[]` | 384-dimensional float array |

#### `remediation_plans`
Stores the neural net diagnosis output for each incident.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `eventId` | `uuid` | FK → `infrastructure_events` |
| `diagnosisClass` | `string` | Predicted crash category label |
| `confidenceScore` | `float` | MLP softmax probability (0–1) |
| `riskLevel` | `enum` | `LOW` \| `HIGH` |
| `suggestedAction` | `enum` | `RESTART_CONTAINER` \| `STOP_CONTAINER` \| `IGNORE` |
| `planState` | `enum` | `PENDING` \| `EXECUTED` \| `SKIPPED` |

#### `action_executions`
Audits the outcome of every executed remediation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `planId` | `uuid` | FK → `remediation_plans` |
| `outcome` | `enum` | `SUCCESS` \| `FAILED` |
| `durationMs` | `int` | End-to-end execution time in milliseconds |
| `executedAt` | `datetime` | Execution timestamp |

#### `metrics_snapshots`
Periodic cluster health snapshots for dashboard visualisation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `capturedAt` | `datetime` | Snapshot timestamp |
| `payload` | `jsonb` | Arbitrary metrics payload |

---

## Security Model

### Layer 1 — Action sandboxing (no shell injection)

A common vulnerability in self-healing infrastructure is **Remote Code Execution (RCE)**. Allowing an AI to output raw terminal commands (e.g. `rm -rf`, `docker run --privileged`) creates unacceptable risk.

**Aegis mitigation:**

- The AI engine is strictly restricted to returning a typed action enum — it cannot generate shell scripts or arbitrary commands
- The NestJS orchestrator maps each enum to hardcoded TypeScript `dockerode` API calls
- No string inputs ever reach a process, `exec`, or shell interface

### Layer 2 — Safety policy gates

Before any action is dispatched to the Docker daemon, the orchestrator evaluates three sequential gates:

```typescript
const isSafetyPassed =
  diagnosis.confidenceScore > 0.85          // 1. Confidence gate
  && diagnosis.riskLevel === 'LOW'           // 2. Risk level gate
  && diagnosis.suggestedAction !== 'IGNORE'; // 3. Action gate
```

| Gate | Condition | Purpose |
|---|---|---|
| **Confidence** | Score > 0.85 | Uncertain models fail open — no auto-healing under ambiguity |
| **Risk level** | `LOW` only | `STOP_CONTAINER` (HIGH) always requires human approval |
| **Action** | Not `IGNORE` | Prevents execution on no-op classification outputs |

**On gate failure:** Plan state → `SKIPPED`, container state → `DEGRADED`, Socket.io notification broadcast to console.

### Layer 3 — Docker socket access control

Mounting `/var/run/docker.sock` grants significant host capabilities. Aegis mitigates this with:

- **Private Docker network:** All services communicate over the `aegis-network` bridge driver. Redis, PostgreSQL, and the AI Engine are not reachable from outside the cluster
- **Scoped write access:** The NestJS container's Docker API usage is limited to `restart` and `stop` lifecycle commands only — it cannot launch privileged containers, bind host paths, or access host files
- **Port minimisation:** Only ports `3000` (web console) and `3001` (API/WebSocket) are exposed to the host network

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 |
| Backend / Orchestration | NestJS (TypeScript) |
| Task Queue | BullMQ + Redis |
| AI Engine | FastAPI (Python 3.10+) |
| Embedding Model | `sentence-transformers/all-MiniLM-L6-v2` |
| Vector Index | FAISS (`faiss-cpu`) |
| Classifier | Scikit-Learn MLP (`MLPClassifier`) |
| Database | PostgreSQL via Prisma ORM |
| Container Runtime | Docker + Docker Compose |
| Docker API Client | `dockerode` (Node.js) |
| Realtime Events | Socket.io |

---


# 👨‍💻 Developed By

## Tushar Kanti Dey  
### Full Stack Developer • DevOps Engineer • AI Infrastructure Enthusiast

Aegis was developed as a capstone project for the Bachelor of Technology (B.Tech) program in Computer Science & Engineering at Adamas University.

The project explores the convergence of autonomous infrastructure orchestration, real-time observability systems, localized artificial intelligence, and deterministic self-healing DevOps pipelines.


## 🔗 Connect

<img src="https://api.iconify.design/lucide:mail.svg?color=%23d14836" alt="Mail" width="16" /> [t.k.d.dey2033929837@gmail.com](mailto:t.k.d.dey2033929837@gmail.com)  
<img src="https://api.iconify.design/mdi:github.svg?color=%23181717" alt="GitHub" width="16" /> [github.com/Tusharxhub](https://github.com/Tusharxhub)  
<img src="https://api.iconify.design/lucide:globe.svg?color=%23007acc" alt="Website" width="16" /> [tushardevx01.tech](https://www.tushardevx01.tech)  
<img src="https://api.iconify.design/mdi:instagram.svg?color=%23e4405f" alt="Instagram" width="16" /> [instagram.com/tushardevx01](https://www.instagram.com/tushardevx01/)


```


## License

Project Aegis is private and proprietary. All rights reserved.