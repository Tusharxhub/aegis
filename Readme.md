# Project Aegis 🛡️ — Local Air-Gapped Self-Healing Infrastructure

Aegis is a 100% local, air-gapped, autonomous DevOps self-healing infrastructure platform that leverages a Reinforcement Learning (RL) loop to detect, analyze, and repair container failures.

Unlike traditional infrastructure automation platforms that rely on static regex triggers, Aegis uses a closed-loop Markov Decision Process (MDP). When a service crashes, it embeds the logs locally via Ollama, sends the state to a Python decision agent running a Stable Baselines3 model, executes healing instructions, and calculates rewards based on the service's survival metrics.

---

## 🏗️ System Architecture & Data Topology

Aegis is fully containerized and runs on a local isolated bridge network (`aegis-network`).

```
[Target Container Crash] ──> Intercepted via /var/run/docker.sock ──> NestJS (Watcher)
                                                                           │
   MongoDB Episode Replay <── [Evaluate Reward & Commit] <── [Wait 10s] <──┼─> [Get Embedding from Ollama]
             │                                                             │
             └──> [Daily Train at 3:00 AM] ──> Python SB3 PPO Brain <──────┘
```

### Container Topology & Ports
1. **`aegis-mongo` (Port 27017)**: The replay buffer database. Stores RL episodes: `{ state_vector, action_taken, reward, next_state_vector, timestamp }`.
2. **`aegis-redis` (Port 6379)**: Event streaming queue for NestJS microservice task dispatching via BullMQ.
3. **`aegis-ollama` (Port 11434)**: Local AI embeddings engine running with NVIDIA GPU passthrough capability.
4. **`aegis-rl-brain` (Port 8000)**: Python 3.10 FastAPI decision engine executing Stable Baselines3 PPO predictions.
5. **`aegis-nestjs` (Port 3001)**: The core Orchestrator. Interacts with the host `/var/run/docker.sock`, schedules training steps, evaluates rewards, and handles WebSocket events.
6. **`aegis-frontend` (Port 3000)**: Cinematic Next.js 14 glassmorphism control dashboard.

---

## 🔒 Security Architecture (API Key Verification)

To prevent unauthorized agents or external containers from triggering action predictions or weight updates, the Python RL Brain service is secured via API Key authentication.

- **Environment Token**: Both Python and NestJS containers share the `AEGIS_INTERNAL_KEY` environment variable.
- **Verification Header**: All HTTP requests targeting `/predict` and `/train` must include the header:
  `X-Aegis-Auth-Token: <AEGIS_INTERNAL_KEY>`
- **Fail-Safe**: FastAPI uses security dependencies (`APIKeyHeader`) to validate incoming headers. Request verification failures immediately return a `401 Unauthorized` response.

---

## 🧠 Reinforcement Learning Framework (MDP)

Aegis handles container recovery actions as a continuous Reinforcement Learning problem:

### 1. State Space (S)
The orchestrator extracts the last 100 lines of logs from the crashed container. It feeds this text to Ollama's embedding API. The returned numeric embedding array is concatenated with status flags:
`State Vector = [ ...embedding_vector (384 values), is_oom (0 or 1), exit_code (normalized exitCode / 255.0) ]`

### 2. Action Space (A)
The agent predicts a discrete action from four options:
- `0` - **DO NOTHING**: Monitor without adjustments.
- `1` - **RESTART CONTAINER**: Issue a container restart command via Dockerode.
- `2` - **ROLLBACK IMAGE VERSION**: Revert the container tag (e.g. `app:v2` to `app:v1`).
- `3` - **SCALE CONTAINER INSTANCES**: Create and start a horizontal replica container (`container-name-replica-<rand>`).

### 3. Reward Function (R)
Calculated post-execution (defaulting to 10 seconds for demo/300 seconds for production):
- **Container Healthy (Running, Exit Code 0)**: `+10` points.
- **Container Crashed Again / Dead**: `-15` points.
- **Step Penalty**: A constant `-1` penalty is applied to every action to discourage unnecessary restarts.

---

## 🚀 Local Air-Gapped Deployment

Follow these instructions to build and run Project Aegis completely offline.

### Prerequisites
- Linux OS (Ubuntu, Fedora, or WSL2)
- Docker and Docker Compose installed
- NVIDIA Driver + NVIDIA Container Toolkit configured (optional, for local GPU embeddings speedup)

### Step 1: Clone and Configure Environment
1. Extract the project.
2. Ensure you have the `AEGIS_INTERNAL_KEY` matching across the containers in the `docker-compose.yml`.

### Step 2: Build & Start Cluster
Launch the full 6-container platform:
```bash
docker compose up --build -d
```

### Step 3: Download Local Embedding Model
Since this is an air-gapped system, the local Ollama instance needs to pull the embeddings model:
```bash
docker exec -it aegis-ollama ollama pull all-minilm
```

### Step 4: Access the System
- **Cinematic Web Dashboard**: Access [http://localhost:3000](http://localhost:3000)
- **NestJS Orchestrator API**: [http://localhost:3001/api](http://localhost:3001/api)
- **RL Brain Health Verification**:
  ```bash
  curl -H "X-Aegis-Auth-Token: your_secure_dev_key" http://localhost:8000/health
  ```

---

## ⚙️ Manual Training & Schedulers
- **Automated Cron Job**: The NestJS app executes a cron task using `@nestjs/schedule` daily at **3:00 AM**, which calls the Python `/train` endpoint.
- **Manual Trigger**: Click the **"Trigger Manual Training"** button on the Next.js UI dashboard to trigger weight updates immediately using historical MongoDB episodes.