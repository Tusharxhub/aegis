Here is the fully expanded, highly detailed `README.md` updated to reflect the local, air-gapped AI architecture using Ollama. This version is designed to look like a heavy-duty, enterprise-grade open-source project.

It includes a native Markdown Mermaid diagram so the architecture visualizes automatically when uploaded to GitHub.

---

```markdown
# Aegis 🛡️ 
**Autonomous Self-Healing DevOps Infrastructure**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat&logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-ea2845?style=flat&logo=nestjs)](https://nestjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Engine-2496ed?style=flat&logo=docker)](https://www.docker.com/)
[![Ollama](https://img.shields.io/badge/Local_AI-Ollama-white?style=flat&logo=ollama)](https://ollama.com/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2d3748?style=flat&logo=prisma)](https://www.prisma.io/)

Aegis is an air-gapped, AI-powered Site Reliability Engineering (SRE) platform. It continuously monitors microservices, detects critical infrastructure failures in real-time, leverages localized Large Language Models (LLMs) to diagnose the root cause, and executes automated mitigation commands—healing the system before human intervention is required.

Unlike standard API-wrapper projects, **Aegis runs its AI inference entirely locally** via Ollama and containerized GPUs, ensuring zero data leakage, zero API latency, and true decentralized operational autonomy.

---

## 🚀 The Core Philosophy: "The Infinity Loop"
Traditional DevOps requires humans to monitor logs, deduce problems, and deploy fixes. Aegis automates the entire incident-response lifecycle:
1. **Observe:** Monitors the Docker UNIX socket for container deaths, OOM (Out of Memory) kills, or unhealthiness.
2. **Analyze:** Reroutes live logs to a local LLM (Qwen 2.5 Coder or Llama 3) configured to return strict, deterministic JSON remediation plans.
3. **Execute:** Bypasses human approval (based on AI confidence scoring) to execute root-level Docker commands (`restart`, `scale`, `rollback`).
4. **Report:** Logs the audit trail to PostgreSQL and streams the UI update via WebSockets.

---

## 🏗️ Deep Architecture

Aegis relies on an event-driven, non-blocking microservice architecture to ensure that heavy machine learning inferences do not halt infrastructure monitoring.

### System Flow Diagram
*(This diagram renders natively on GitHub)*

```mermaid
graph TD
    %% Define Nodes
    subgraph Host OS [Host Machine / Linux Server]
        DockerSocket[Docker Daemon /var/run/docker.sock]
        BrokenService[Failing Microservice Container]
    end

    subgraph The Orchestrator [NestJS Backend]
        Watcher[Docker Watcher Service]
        Queue[BullMQ / Redis Event Queue]
        Executor[Action Execution Engine]
    end

    subgraph The Brain [Air-gapped AI]
        Ollama[Ollama Container]
        Model[Llama 3 / Qwen Coder]
    end

    subgraph State & Observability [Data Layer]
        DB[(PostgreSQL)]
        Prisma[Prisma ORM]
    end

    subgraph UI [Next.js Control Center]
        Dashboard[Glassmorphism Dashboard]
    end

    %% Define Flow
    BrokenService -- "Crashes (OOM, Timeout)" --> DockerSocket
    DockerSocket -- "Emits 'die' event & Logs" --> Watcher
    Watcher -- "Pushes job" --> Queue
    Queue -- "Pulls job asynchronously" --> Executor
    Executor -- "Prompts with strict JSON schema" --> Ollama
    Ollama -- "Runs inference on GPU" --> Model
    Model -- "Returns { action: 'restart' }" --> Ollama
    Ollama -- "Passes JSON Plan" --> Executor
    
    %% Execution & State
    Executor -- "Executes mitigation" --> DockerSocket
    Executor -- "Saves Audit Trail" --> Prisma
    Prisma -- "Writes" --> DB
    
    %% Real-time update
    Executor -- "Emits WebSocket Event" --> Dashboard

```

### The Stack Breakdown

* **The Controller (Backend):** NestJS (TypeScript), `dockerode` (Docker API), BullMQ + Redis.
* **The Brain (AI Inference):** Ollama, NVIDIA Container Toolkit (for local GPU passthrough).
* **The Ledger (Database):** PostgreSQL, Prisma ORM.
* **The Dashboard (Frontend):** Next.js (React), Tailwind CSS, Socket.io-client.

---

## ⚡ Hardware & System Requirements

Because Aegis utilizes local LLM inference, it requires hardware capable of running an AI model efficiently.

* **OS:** Linux natively (e.g., Fedora, Ubuntu) or WSL2 on Windows.
* **Compute:** A dedicated GPU is highly recommended for real-time healing (e.g., NVIDIA RTX series / ASUS TUF Gaming rigs).
* **Drivers:** NVIDIA Drivers and the `nvidia-container-toolkit` must be installed to allow the Ollama Docker container to access the host GPU.
* **Dependencies:** Docker Engine, Docker Compose, Node.js (v18+).

---

## 🛠️ Installation & Setup

**1. Clone the Repository:**

```bash
git clone [https://github.com/yourusername/aegis.git](https://github.com/yourusername/aegis.git)
cd aegis

```

**2. Setup the Environment:**
Create a `.env` file in the root directory:

```env
DATABASE_URL="postgresql://aegis_user:password@localhost:5432/aegis_db"
REDIS_URL="redis://localhost:6379"
OLLAMA_HOST="http://localhost:11434"
AI_CONFIDENCE_THRESHOLD="0.80" # Minimum confidence required for auto-execution

```

**3. Boot the Infrastructure (Database, Redis, AI Engine):**

```bash
docker-compose up -d

```

*Note: The `docker-compose.yml` mounts `/var/run/docker.sock` and allocates GPU resources to the Ollama container.*

**4. Pull the Local AI Model:**
Wait for the Ollama container to boot, then pull your preferred coding model:

```bash
docker exec -it aegis-ollama ollama run qwen2.5-coder:7b

```

**5. Initialize the Database:**

```bash
cd backend
npx prisma generate
npx prisma db push

```

**6. Start the Orchestrator & Dashboard:**

```bash
# Terminal 1: Start NestJS Backend
cd backend && npm run start:dev

# Terminal 2: Start Next.js Frontend
cd frontend && npm run dev

```

---

## 🧪 Simulation & Testing

To demonstrate Aegis during a live review, the project includes a "Chaos Script" that intentionally damages a dummy container.

1. Navigate to the Aegis Dashboard (`http://localhost:3000`).
2. Run the chaos script to simulate a memory leak:
```bash
npm run simulate:oom

```


3. Watch the dashboard as Aegis detects the failure, streams the AI diagnosis in real-time, and issues the restart command via Docker—restoring the node to a healthy state automatically.

---

## 👨‍💻 Developed By

Built as a comprehensive 4th-Year B.Tech Computer Science Engineering project, engineered to showcase enterprise-level Full Stack Development, DevOps automation, and localized AI infrastructure.

```

```