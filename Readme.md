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

Aegis is your always-on SRE sidekick that runs entirely on your hardware. It keeps a watchful eye on your microservices, spots problems the moment they happen, uses local AI to figure out what went wrong, and fixes things automatically—often before you even notice something broke.

Best part? **Everything stays on your machine.** No cloud APIs, no data leaving your server, no waiting for external services. Just pure, self-healing infrastructure running right there in your Docker setup.

---

## 🚀 The Core Philosophy: "The Infinity Loop"
Traditionally, someone's gotta stay up at night watching logs, scratching their head, and manually restarting services. Aegis changes that game:

1. **Observe:** Watches your containers 24/7. Detects when something crashes, runs out of memory, or just starts acting weird.
2. **Analyze:** Sends the problem to a local AI model (Qwen 2.5 Coder or Llama 3) that figures out exactly what went wrong.
3. **Execute:** If the AI is confident enough, it doesn't wait around—it goes ahead and fixes it automatically (restarts, scales, rolls back, whatever's needed).
4. **Report:** Keeps a full audit trail in the database and updates your dashboard in real-time so you're never in the dark.

---

## 🏗️ Deep Architecture

Aegis uses a smart, event-driven design so that heavy AI thinking doesn't slow down your monitoring. Everything runs asynchronously—the system keeps watching your infrastructure while the brain is busy thinking in the background.

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

### What We Built With

* **The Brains (Backend):** NestJS handles all the orchestration, talks to Docker, and queues up tasks using BullMQ.
* **The Thinker (AI):** Ollama runs your local AI model—no external APIs, just pure local inference on your GPU.
* **The Memory (Database):** PostgreSQL stores everything, and Prisma keeps the queries clean and type-safe.
* **The Face (Frontend):** A sleek Next.js dashboard that streams updates in real-time so you can see exactly what's happening.

---

## ⚡ Hardware & System Requirements

Since Aegis thinks locally with real AI models, you'll need some decent hardware.

* **OS:** Linux (Ubuntu, Fedora, etc.) or WSL2 on Windows—that's where Docker shines.
* **GPU:** Honestly, you'll want a real GPU for this. NVIDIA RTX cards work great. Without one, inference gets slow fast.
* **Drivers:** You'll need NVIDIA drivers and the `nvidia-container-toolkit` so Ollama can actually use your GPU.
* **Basics:** Docker, Docker Compose, Node.js 18+, and Redis. Pretty standard modern stack stuff.

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

## 🧪 See It In Action

Want to watch Aegis work its magic? We included a chaos script that deliberately breaks a test container.

1. Open up the dashboard at `http://localhost:3000`.
2. Trigger a controlled failure:
```bash
npm run simulate:oom
```

3. Sit back and watch. You'll see Aegis spot the problem, the AI figure out what happened, and the system automatically heal itself—all in real-time on your screen.

---

## 👨‍💻 Who Built This

This is a 4th-year Computer Science project, built from scratch to show what's possible when you combine full-stack development, real DevOps thinking, and local AI. It's the kind of thing you'd see in production, not just in a lab.

```

```