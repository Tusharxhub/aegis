<div align="center">

```
 █████╗ ███████╗ ██████╗ ██╗███████╗
██╔══██╗██╔════╝██╔════╝ ██║██╔════╝
███████║█████╗  ██║  ███╗██║███████╗
██╔══██║██╔══╝  ██║   ██║██║╚════██║
██║  ██║███████╗╚██████╔╝██║███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝
```

### 🛡️ Air-Gapped AIOps & Reinforcement Learning Infrastructure

*Closed-loop • Local-first • Self-healing*

---

[![NestJS](https://img.shields.io/badge/NestJS-11-ea2845?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Kafka](https://img.shields.io/badge/Kafka-KRaft-231f20?style=for-the-badge&logo=apachekafka&logoColor=white)](https://kafka.apache.org/)
[![Python](https://img.shields.io/badge/Python-3.10-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Engine-2496ed?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Local-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-Queue-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)

</div>

---

## ✦ What is Aegis?

> **Aegis** is a closed-loop, local-first SRE platform built around Docker event capture, Kafka streaming, and AI-assisted remediation.

The orchestration stack runs entirely on-prem — no cloud, no telemetry, no external dependencies. The NestJS orchestrator watches container events, publishes typed Kafka messages, stores audit and incident data in MongoDB, and relays normalized updates to connected clients through Socket.io. A Python AI engine and RL agent handle model training and crash-simulation workflows offline.

---

## ⚡ Core Capabilities

| Capability | Description |
|---|---|
| 🐳 **Container Watching** | Tracks Docker container lifecycle and crash events in real time |
| 📡 **Kafka Event Bus** | Publishes typed events across incident, log, diagnosis, remediation, and audit topics |
| 🩺 **Health Monitoring** | Tracks Kafka producer and consumer health for operator visibility |
| 🗄️ **Durable Storage** | MongoDB persists plans, services, episodes, and replay history |
| ⚙️ **Async Queuing** | Redis and BullMQ handle background work and async processing |
| 🔌 **Live Gateway** | Socket.io broadcasts normalized system events to connected clients |
| 🤖 **AI Engine** | Python-based offline training, diagnosis, and RL policy workflows |
| 💥 **Chaos Testing** | Built-in demo crash service for local simulation |

---

## 🏛️ Architecture

```mermaid
graph TD
    Docker[Docker Daemon Events]
    Backend[NestJS Orchestrator]
    Kafka[(Kafka KRaft Cluster)]
    Mongo[(MongoDB)]
    Redis[(Redis / BullMQ)]
    AI[Python AI Engine]
    RL[Python RL Agent]
    Crash[demo-crash-service]
    UI[Optional dashboard client]

    Crash --> Docker
    Docker --> Backend
    Backend --> Kafka
    Backend --> Mongo
    Backend --> Redis
    Kafka --> Backend
    Backend --> AI
    AI --> RL
    Backend --> UI
    Kafka --> UI
```

---

## 🔬 Deep Architecture Flow

```mermaid
graph TD
    %% Environment
    subgraph Edge Environment [Local Docker Network]
        DockerSocket[Docker Daemon Socket]
        BrokenService[Failing Microservice Container]
    end

    %% Backend Orchestrator
    subgraph The Orchestrator [NestJS Container]
        Watcher[Telemetry Watcher]
        RL_Coord[RL Coordinator]
        Executor[Execution Engine]
    end

    %% AI Compute
    subgraph Data Processing [GPU Inference]
        Ollama[Ollama Container]
        Embeddings[Text-to-Vector Embeddings]
    end

    %% RL Brain
    subgraph The Brain [Python FastAPI]
        Agent[Stable Baselines3 Policy]
    end

    %% State
    subgraph Memory [Local Data]
        Mongo[(MongoDB Replay Buffer)]
        Redis[(Redis Event Queue)]
    end

    %% Flow
    BrokenService -- "Crash (OOM/Timeout)" --> DockerSocket
    DockerSocket -- "Intercepts Event" --> Watcher
    Watcher -- "Queues Logs" --> Redis
    Redis -- "Pulls Async" --> RL_Coord
    RL_Coord -- "Requests Vector" --> Ollama
    Ollama -- "Returns Vector [0.12, -0.4...]" --> RL_Coord
    RL_Coord -- "State Vector + API Key" --> Agent
    Agent -- "Predicts Action [1: Restart]" --> RL_Coord
    RL_Coord -- "Executes mitigation" --> Executor
    Executor -- "Issues command" --> DockerSocket
    Executor -- "Evaluates 5-Min Survival Reward" --> Mongo
    Mongo -- "Daily Batch Training" --> Agent
```

---

## 🧱 Tech Stack

<table>
<tr>
<td valign="top" width="50%">

### 🟥 Backend Orchestrator
- **NestJS 11** + TypeScript
- **KafkaJS** — typed event publishing & consuming
- **Socket.io** — realtime event relay gateway
- **Dockerode** — Docker event handling
- **BullMQ + Redis** — async queueing
- **Mongoose + MongoDB** — durable persistence

</td>
<td valign="top" width="50%">

### 🟧 Streaming Layer
- **Kafka** in KRaft mode *(no ZooKeeper)*
- **Kafka UI** — local topic inspection
- Topics: `container` · `incident` · `logs` · `diagnosis` · `remediation` · `metrics` · `audit`

</td>
</tr>
<tr>
<td valign="top" width="50%">

### 🟦 Python Services
- `services/ai-engine` — model training & inference
- `rl-agent` — reinforcement-learning control loop
- `demo-crash-service` — chaos simulation

</td>
<td valign="top" width="50%">

### 🟩 Infrastructure
- **Docker Compose** — single-command full-stack
- **KRaft Kafka** — no external ZooKeeper dependency
- Fully **air-gapped** by design

</td>
</tr>
</table>

---

## 🚀 Local Setup

### Prerequisites

```
Docker Engine & Docker Compose
Node.js  ≥ 20
Python   ≥ 3.10
```

### Start the Full Stack

```bash
docker compose up --build -d
```

> Spins up: MongoDB · Redis · Kafka · Kafka UI · NestJS backend · AI engine · Demo crash service

### Development Mode

```bash
cd backend && npm run start:dev
```

> Runs the NestJS orchestrator locally while keeping all supporting services in Docker.

---

## 🌐 Access Points

| Service | URL / Address |
|---|---|
| 🖥️ Backend API + Socket.io | `http://localhost:3001` |
| 📊 Kafka UI | `http://localhost:8080` |
| 🗄️ MongoDB | `localhost:27017` |
| ⚡ Redis | `localhost:6379` |
| 📨 Kafka Broker | `localhost:9092` |
| 🤖 AI Engine | `http://localhost:8000` |
| 💥 Demo Crash Service | `http://localhost:3002` |

---

## 🔄 Kafka Event Flow

```
① Docker emits a container event
        ↓
② NestJS normalizes & publishes to Kafka
        ↓
③ Kafka consumers validate & classify the stream
        ↓
④ Dashboard relay broadcasts via Socket.io
        ↓
⑤ MongoDB persists history & audit trail
```

---

## 🔭 Under Development

- [ ] 🖥️ Browser dashboard for live Kafka event visualization
- [ ] 🛠️ Operator-focused remediation controls & incident review views
- [ ] 🧠 Expanded RL training & policy evaluation workflows
- [ ] 🔗 Additional service integrations for broader observability coverage

---

## 📌 Design Principles

> **Local by default.** Kafka, Redis, MongoDB, and the backend all run on your own machine.
> No telemetry. No cloud dependency. No surprises.

- 🔒 Air-gapped — zero external network requirements at runtime
- 🔁 Closed-loop — detect → diagnose → remediate → learn, all locally
- 📜 Auditable — every action persisted in MongoDB for replay and review
- 🧩 Modular — each service is independently replaceable

---

## 👨‍💻 Developed By

<div align="center">

### Tushar Kanti Dey
*Full Stack Developer · DevOps Engineer · AI Infrastructure Enthusiast*

---

*Aegis was developed as a capstone project for the*
*Bachelor of Technology (B.Tech) in Computer Science & Engineering*
*at **Adamas University***

---

*Engineered to explore the convergence of autonomous infrastructure orchestration,*
*real-time observability, and localized AI systems — demonstrating how modern*
*DevOps environments can evolve from passive monitoring into intelligent,*
*self-healing platforms capable of deterministic recovery and autonomous*
*operational decision-making.*

---

[![Email](https://img.shields.io/badge/Email-t.k.d.dey2033929837%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:t.k.d.dey2033929837@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-Tusharxhub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Tusharxhub)
[![Portfolio](https://img.shields.io/badge/Portfolio-tushardevx01.tech-0A0A0A?style=for-the-badge&logo=vercel&logoColor=white)](https://www.tushardevx01.tech)
[![Instagram](https://img.shields.io/badge/Instagram-tushardevx01-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/tushardevx01/)

</div>

---

<div align="center">

*Built with precision. Deployed locally. Evolving autonomously.*

**⭐ Star this repo if Aegis inspires your infrastructure thinking**

</div>