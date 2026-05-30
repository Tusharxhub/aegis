# Project Aegis 🛡️ — Platform Security Specification

This document details the security model, container network configurations, and execution safety checks of Aegis.

---

## 🔒 The Safety Action Registry (No Shell Injection)

A common vulnerability in self-healing infrastructure is **Remote Code Execution (RCE)**. If an AI engine determines that a container needs repair, allowing it to output raw terminal command lines (e.g. `rm -rf` or `docker run --privileged`) creates high-risk security bounds.

### Aegis Mitigation:
- **Enum-only Output**: The custom AI engine is strictly sandbox-restricted. It cannot generate shell scripts. It returns an action enum from a fixed registry:
  - `RESTART_CONTAINER`
  - `STOP_CONTAINER`
  - `IGNORE`
- **Execution Mapping**: The NestJS orchestrator intercepts the enum and maps it programmatically to hardcoded TypeScript calls using `dockerode` APIs. No string inputs are passed to processes or shell interfaces.

---

## 🚦 Safety Policy Gates

Before executing any action mapped to the Docker daemon, the orchestrator evaluates the AI's diagnosis response against safety gates:

```typescript
const isSafetyPassed =
  diagnosis.confidenceScore > 0.85 &&
  diagnosis.riskLevel === 'LOW' &&
  diagnosis.suggestedAction !== 'IGNORE';
```

- **Confidence Score Gate**: The MLP classifier's probability score must exceed **85%**. If the model is uncertain, it fails open and skips auto-healing.
- **Risk Level Gate**: Mapped actions have assigned risk levels:
  - `RESTART_CONTAINER` -> `LOW` risk. Safe to execute automatically.
  - `STOP_CONTAINER` -> `HIGH` risk (stops active services). Requires operator manual confirmation via the Next.js control center.
- **Fail-Safe Policy**: If any safety check fails, the plan state is marked as `SKIPPED`, a notification is sent, and the container state is set to `DEGRADED` for operator review.

---

## 🛡️ Docker Daemon Socket Access Control

Mounting the UNIX domain socket `/var/run/docker.sock` inside the NestJS container gives it significant capabilities. We isolate this permission layer using the following steps:

1. **Private Docker Network**: All Aegis containers communicate over `aegis-network` using a bridge driver. Host ingress ports are restricted:
   - Frontend: Port 3000 (HTTP)
   - Backend: Port 3001 (WebSockets/APIs)
   - Redis, MongoDB, and AI Engine are **not exposed** to the host. They are accessible only within the container bridge network.
2. **Read-Only Watching**: The NestJS application limits its write instructions to specific container lifecycle commands (`restart`, `stop`). It has no capability to launch privileged containers or access host files.
