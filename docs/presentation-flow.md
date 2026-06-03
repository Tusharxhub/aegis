# Project Aegis — Live Demonstration Flow

This guide explains how to demonstrate the complete Aegis self-healing pipeline to professors and evaluators. Follow the steps in order.

---

## Prerequisites

Make sure all infrastructure is running before starting the demo:

```bash
docker compose up -d --build
npm run start:dev
```

Wait about 30 seconds for all services to initialize.

---

## Step 1: Verify Infrastructure Health

Run the infrastructure health check to confirm everything is online:

```bash
aegis doctor
```

**What the professors see:** A clean pass/fail report showing Docker, MongoDB, Kafka, AI Engine, Demo Service, and the NestJS Backend are all operational.

**Expected output:**
```
[✓] Docker: Docker daemon is reachable
[✓] MongoDB: MongoDB is responding to ping
[✓] Kafka: Kafka broker healthy at localhost:9092
[✓] NestJS Backend: Responding at http://localhost:3001/api/health
[✓] AI Engine: Responding at http://localhost:8000/health
[✓] Demo Crash Service: Responding at http://localhost:3000/health

[✓] All 6 checks passed. Aegis is fully operational.
```

---

## Step 2: View Platform Status

Show the current state of all containers and any existing incidents:

```bash
aegis status
```

**What the professors see:** A live dashboard showing running containers, recent incidents (if any), and remediation history.

---

## Step 3: Start Kafka Stream (in a separate terminal)

Open a second terminal and start the real-time Kafka event stream:

```bash
aegis stream
```

**What the professors see:** The terminal is now listening to all Aegis Kafka topics. Events will appear in real-time as they flow through the system.

**Leave this terminal running during the demo.**

---

## Step 4: Trigger a Chaos Event (OOM Crash)

In the first terminal, trigger an OOM crash on the demo service:

```bash
aegis chaos oom
```

**What happens behind the scenes:**

1. The CLI sends an HTTP request to `demo-crash-service:3000/crash/oom`
2. The Node.js process allocates massive arrays until it runs out of memory
3. The container crashes (exit code 137 or 139)
4. Docker emits a `die` event on the Docker socket

**What Aegis does automatically (under 1 second):**

1. **Docker Watchman** detects the `die` event from the Docker socket
2. **Log Extraction** pulls the last 100 lines of crash logs
3. **Kafka Producer** publishes `aegis.container.events` with the crash data
4. **MongoDB** stores the incident record
5. **AI Engine** receives the logs, generates an embedding, classifies the incident as `OOM_KILL`
6. **Safety Policy** checks confidence (≥0.85) and risk level (LOW)
7. **Remediation Engine** restarts the container via Dockerode API
8. **Audit Trail** stores the complete remediation record

**What the CLI shows:**
```
[✓] [AIOps Verified] Container was successfully crashed
[✓] and automatically healed by Aegis!
```

---

## Step 5: Show the Kafka Stream

Switch to the terminal running `aegis stream`. You should see events like:

```
aegis.container.events     CONTAINER_LIFECYCLE :: watchman :: <id>
aegis.incident.detected    INCIDENT_DETECTED :: incident-service :: <id>
aegis.ai.diagnosis.completed  AI_DIAGNOSIS_COMPLETED :: ai-engine :: <id>
aegis.remediation.started  REMEDIATION_STARTED :: remediation-engine :: <id>
aegis.remediation.completed REMEDIATION_COMPLETED :: remediation-engine :: <id>
```

**Key talking point:** Each stage of the pipeline publishes a separate Kafka event. This creates a complete, auditable event stream of every action Aegis took.

---

## Step 6: Verify Incident in MongoDB

Check the incident was stored:

```bash
curl http://localhost:3001/api/orchestrator/incidents | python3 -m json.tool
```

**What the professors see:** A JSON array of stored incidents with event type, exit code, timestamps, and log previews.

---

## Step 7: Verify Remediation Record

Check the remediation plan:

```bash
curl http://localhost:3001/api/orchestrator/remediations | python3 -m json.tool
```

**What the professors see:** Remediation plans with AI-generated analysis, confidence scores, risk levels, suggested actions, and execution status.

---

## Step 8: Verify Container is Running Again

```bash
docker ps --filter name=demo-crash-service
```

**What the professors see:** The container is running again with a fresh uptime (a few seconds), proving Aegis restarted it automatically.

---

## Step 9: Try Other Chaos Modes (Optional)

Demonstrate different failure types:

```bash
# Database timeout crash
aegis chaos timeout

# General process crash
aegis chaos crash

# Permission denied error
aegis chaos permission

# Port collision error
aegis chaos port
```

Each triggers a different failure pattern, and the AI engine classifies them differently:
- `timeout` → `DB_TIMEOUT` → RESTART_CONTAINER
- `crash` → detects from logs → appropriate action
- `permission` → `PERMISSION_DENIED` → IGNORE (cannot fix by restarting)
- `port` → `PORT_COLLISION` → STOP_CONTAINER (restart would loop)

---

## Step 10: Check AI Engine Health

```bash
curl http://localhost:8000/health | python3 -m json.tool
```

Shows the AI engine status: SentenceTransformer loaded, MLP classifier loaded, FAISS vector store active, Kafka consumer running.

---

## Key Talking Points for Professors

### "What makes this different from a simple restart script?"

1. **Intelligence**: The AI engine classifies the failure type using machine learning (SentenceTransformers + MLP), not string matching
2. **Safety**: The policy engine prevents dangerous automatic actions — only executes when confidence ≥ 85% AND risk is LOW
3. **Auditability**: Every action is recorded in MongoDB and published to Kafka, creating a complete audit trail
4. **Scalability**: Kafka-driven architecture means the system can scale horizontally
5. **No cloud dependency**: Everything runs locally — no API keys, no cloud costs

### "How does the AI work?"

1. Container crash logs are embedded into 384-dimensional vectors using SentenceTransformers (all-MiniLM-L6-v2)
2. An MLP classifier maps embeddings to 6 incident classes (OOM_KILL, DB_TIMEOUT, PORT_COLLISION, etc.)
3. FAISS performs similarity search against historical incidents
4. Each incident class has a deterministic action mapping (restart, stop, or ignore)
5. The model auto-trains on synthetic data if no pre-trained weights exist

### "How is this secure?"

1. No shell command execution — all Docker actions use the Dockerode API
2. Only 3 allowed actions: RESTART_CONTAINER, STOP_CONTAINER, IGNORE
3. Confidence and risk gate prevents low-confidence automated actions
4. Internal API endpoints are protected by token-based guards
5. No cloud AI APIs — everything is local and offline

---

## Cleanup

After the demo:

```bash
docker compose down        # Stop all containers
```

To fully reset:

```bash
node scripts/reset-docker-and-rebuild.js
```
