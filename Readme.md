# Aegis 🛡️

### Autonomous Self-Healing DevOps Infrastructure

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat\&logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-ea2845?style=flat\&logo=nestjs)](https://nestjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Engine-2496ed?style=flat\&logo=docker)](https://www.docker.com/)
[![Ollama](https://img.shields.io/badge/Local_AI-Ollama-white?style=flat\&logo=ollama)](https://ollama.com/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2d3748?style=flat\&logo=prisma)](https://www.prisma.io/)

Aegis is an autonomous DevOps monitoring and self-healing platform built for modern containerized infrastructure. It continuously monitors Docker-based services, detects failures in real time, analyzes incidents using local AI models running through Ollama, and automatically executes recovery actions without depending on external cloud APIs.

Everything runs locally. Logs, AI inference, monitoring, recovery workflows, and analytics all stay inside your own infrastructure. No external telemetry, no vendor lock-in, and no data leaving your machine.

This project combines DevOps automation, distributed systems concepts, local LLM orchestration, real-time observability, and full-stack engineering into a production-style platform.

---

# 🚀 Core Workflow

Aegis follows a fully autonomous event-driven recovery cycle:

### 1. Observe

The monitoring engine watches Docker containers continuously and detects:

* Container crashes
* Out-of-memory failures
* Restart loops
* High CPU or memory spikes
* Service health-check failures
* Timeout issues
* Abnormal runtime behavior

### 2. Analyze

Once a failure is detected:

* Logs are collected automatically
* Runtime metadata is extracted
* The incident is forwarded to a local AI model
* The AI determines the probable root cause
* A structured recovery plan is generated

### 3. Execute

If the confidence score crosses the configured threshold, Aegis can:

* Restart containers
* Scale services
* Roll back unhealthy deployments
* Kill stuck processes
* Recreate containers
* Trigger fallback workflows

### 4. Report

Every action is tracked and stored:

* Full audit logs
* AI reasoning history
* Recovery timeline
* Real-time dashboard updates
* Infrastructure analytics

---

# 🏗️ System Architecture

Aegis uses an asynchronous event-driven architecture to ensure monitoring remains lightweight even while AI analysis is running in the background.

## Architecture Flow

```mermaid
graph TD

    subgraph Host["Host Machine / Linux Server"]
        DockerSocket["Docker Daemon"]
        BrokenService["Failing Container"]
    end

    subgraph Backend["NestJS Orchestrator"]
        Watcher["Docker Watcher Service"]
        Queue["BullMQ + Redis Queue"]
        Executor["Execution Engine"]
    end

    subgraph AI["Local AI Runtime"]
        Ollama["Ollama"]
        Model["Qwen / Llama Models"]
    end

    subgraph Data["State & Persistence"]
        Prisma["Prisma ORM"]
        DB["PostgreSQL"]
    end

    subgraph Frontend["Next.js Dashboard"]
        Dashboard["Realtime Monitoring UI"]
    end

    BrokenService --> DockerSocket
    DockerSocket --> Watcher
    Watcher --> Queue
    Queue --> Executor
    Executor --> Ollama
    Ollama --> Model
    Model --> Ollama
    Ollama --> Executor

    Executor --> DockerSocket
    Executor --> Prisma
    Prisma --> DB

    Executor --> Dashboard
```

---

# ⚙️ Tech Stack

## Frontend

* Next.js 14
* TypeScript
* Tailwind CSS
* Framer Motion
* WebSockets
* Recharts

## Backend

* NestJS
* BullMQ
* Redis
* Docker API
* WebSocket Gateway

## AI Layer

* Ollama
* Qwen 2.5 Coder
* Llama 3

## Database

* PostgreSQL
* Prisma ORM

## Infrastructure

* Docker
* Docker Compose
* NVIDIA Container Toolkit

---

# 🔥 Key Features

## Autonomous Recovery

Automatically detects and resolves infrastructure failures.

## Local AI Analysis

Uses fully offline local LLMs for root-cause analysis.

## Real-Time Monitoring

Live dashboard updates through WebSockets.

## Event Queue System

Asynchronous task processing with BullMQ and Redis.

## Infrastructure Audit Trail

Every AI decision and recovery action is stored permanently.

## GPU-Accelerated Inference

Runs AI inference locally using NVIDIA GPUs.

## Air-Gapped Deployment

Works entirely without internet access.

## Production-Oriented Design

Built with scalable backend architecture and modular services.

---

# 🖥️ System Requirements

## Recommended Hardware

| Component | Recommendation               |
| --------- | ---------------------------- |
| CPU       | Ryzen 7 / Intel i7 or higher |
| RAM       | 16GB minimum                 |
| GPU       | NVIDIA RTX Series            |
| Storage   | SSD Recommended              |

## Software Requirements

* Linux (Ubuntu / Fedora preferred)
* Docker Engine
* Docker Compose
* Node.js 18+
* Redis
* PostgreSQL
* NVIDIA Drivers
* NVIDIA Container Toolkit

---

# 📦 Installation

## 1. Clone Repository

```bash
git clone https://github.com/yourusername/aegis.git
cd aegis
```

---

## 2. Configure Environment Variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://aegis_user:password@localhost:5432/aegis_db"

REDIS_URL="redis://localhost:6379"

OLLAMA_HOST="http://localhost:11434"

AI_CONFIDENCE_THRESHOLD="0.80"
```

---

## 3. Start Infrastructure

```bash
docker-compose up -d
```

This starts:

* PostgreSQL
* Redis
* Ollama
* Supporting containers

---

## 4. Pull AI Model

```bash
docker exec -it aegis-ollama ollama run qwen2.5-coder:7b
```

---

## 5. Initialize Database

```bash
cd backend

npx prisma generate

npx prisma db push
```

---

## 6. Start Backend

```bash
cd backend

npm run start:dev
```

---

## 7. Start Frontend

```bash
cd frontend

npm run dev
```

---

# 🧪 Failure Simulation

Aegis includes a built-in chaos testing utility.

## Trigger OOM Failure

```bash
npm run simulate:oom
```

You can then watch:

* Failure detection
* AI analysis
* Recovery execution
* Dashboard updates

in real time.

---

# 📊 Future Improvements

* Kubernetes support
* Multi-node orchestration
* Predictive anomaly detection
* AI-generated recovery scripts
* Distributed observability
* Infrastructure graph visualization
* SLA analytics
* RBAC authentication
* Multi-tenant support

---

# 👨‍💻 Project Vision

Aegis was designed as a production-style DevOps platform that demonstrates how AI can move beyond chat interfaces and become an active infrastructure operator.

The goal is to create an autonomous infrastructure layer capable of monitoring, reasoning, and recovering systems with minimal human intervention while keeping everything local, private, and controllable.

This project combines:

* Full-stack engineering
* AI systems integration
* DevOps automation
* Distributed infrastructure concepts
* Real-time monitoring
* Event-driven architecture
* Self-healing system design

into a single platform built for modern infrastructure environments.

---

# 📬 Contact

📧 [Email](mailto:t.k.d.dey2033929837@gmail.com)
🔗 [GitHub](https://github.com/Tusharxhub)
📸 [Instagram](https://www.instagram.com/tushardevx01/)

