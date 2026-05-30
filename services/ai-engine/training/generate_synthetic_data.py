import os
import csv
import random

CLASSES = {
    "OOM_KILL": 0,
    "DB_TIMEOUT": 1,
    "PORT_COLLISION": 2,
    "CRASH_LOOP": 3,
    "MEMORY_LEAK": 4,
    "PERMISSION_DENIED": 5
}

# ─────────────────────────────────────────────────────────────────────────────
# Synthetic Log Snippets by Incident Class
# ─────────────────────────────────────────────────────────────────────────────

TEMPLATES = {
    "OOM_KILL": [
        "kernel: Out of memory: Kill process {pid} ({proc}) score {score} or sacrifice child",
        "Killed process {pid} ({proc}) total-vm:{vm}kB, anon-rss:{rss}kB, file-rss:0kB",
        "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory",
        "Error: memory limit exceeded. container {container_id} oom-killed by daemon.",
        "java.lang.OutOfMemoryError: Java heap space. Exiting JVM thread...",
        "RuntimeError: CUDA out of memory. Tried to allocate {size} MiB (GPU 0; {total} GiB total capacity)",
        "Container {container_id} received SIGKILL (Exit code 137). Linux kernel OOM-killer triggered."
    ],
    "DB_TIMEOUT": [
        "PrismaClientInitializationError: Can't reach database server at {host}:{port}. Connection timed out.",
        "Connection timeout: Failed to connect to postgresql://{user}@{host}/main after {timeout}ms",
        "SequelizeConnectionError: connect ETIMEDOUT {host}:{port}",
        "MongoNetworkError: connection timed out to database host {host}:{port} on client socket",
        "OperationalError: (psycopg2.OperationalError) connection to server at '{host}' ({ip}), port {port} failed: Connection timed out",
        "Warning: Database query took {query_time}s which exceeds config limit of 5.0s. Transaction aborted.",
        "Database pool capacity reached. Failed to acquire connection in {timeout}s. Request failed."
    ],
    "PORT_COLLISION": [
        "Error: listen EADDRINUSE: address already in use :::{port}",
        "FATAL: Listen port {port} already bound to another active system process",
        "bind() failed: Address already in use on port {port}. Stopping server boot.",
        "Failed to start Nest application. NestJS cannot bind port {port} on local network.",
        "nginx: [emerg] bind() to 0.0.0.0:{port} failed (98: Address already in use)",
        "Web server failed to start: Port {port} is occupied by container {other_id}",
        "SocketException: Permission denied / address in use on 0.0.0.0:{port}"
    ],
    "CRASH_LOOP": [
        "npm ERR! crash-service@1.0.0 start: node index.js. Exited with exit code 1",
        "Uncaught ReferenceError: {variable} is not defined in runtime loop index.js:{line}",
        "TypeError: Cannot read properties of undefined (reading '{prop}') at main.ts:{line}",
        "Container restarted {count} times in the last 2 minutes. Failing healthcheck validation.",
        "ModuleNotFoundError: No module named '{module}' in main entry-point file.",
        "Application crashed immediately upon startup. Exit code {exit_code}.",
        "CRITICAL: Infinite recursion detected in configuration parser. Stack overflow."
    ],
    "MEMORY_LEAK": [
        "Warning: Possible EventEmitter memory leak detected. {count} listeners added to [EventEmitter].",
        "Process memory usage exceeded limit threshold. Current RSS: {rss_gb} GB, heapUsed: {heap_gb} GB",
        "GC overhead limit exceeded. CPU spent 98% on Garbage Collection during active socket worker.",
        "Leak Warning: Active handles pool is growing continuously. Current handles: {handle_count}",
        "Heap allocation analyzer: Memory leak suspected. Heap increased linearly by {leak_mb}MB in {duration}s",
        "Process memory constantly climbing without garbage collection. RSS: {rss_gb} GB. Exceeded policy limit.",
        "FATAL: heap allocation failure in garbage collector. Node process terminating."
    ],
    "PERMISSION_DENIED": [
        "EACCES: permission denied, open '{filepath}'",
        "FATAL: Access denied to local socket file {filepath}",
        "sqlite3.OperationalError: attempt to write a readonly database file at {filepath}",
        "PermissionError: [Errno 13] Permission denied: '{filepath}'",
        "Error: Docker credentials read-only. Cannot write state to {filepath}",
        "Unauthorized access: Failed to run service because user lacks read/write permissions for {filepath}",
        "IOError: [Errno 13] Cannot open file {filepath} due to inadequate system access privileges."
    ]
}

def generate_log(incident_type):
    template = random.choice(TEMPLATES[incident_type])
    
    # Fill in random data variables
    params = {
        "pid": random.randint(100, 9999),
        "proc": random.choice(["node", "python3", "java", "postgres", "redis-server"]),
        "score": random.randint(700, 999),
        "vm": random.randint(100000, 900000),
        "rss": random.randint(2000, 8000),
        "size": random.randint(64, 2048),
        "total": random.choice([8, 16, 24, 32]),
        "container_id": f"aegis-worker-{random.randint(100,999)}",
        "other_id": f"aegis-other-{random.randint(100,999)}",
        "host": random.choice(["aegis-postgres", "aegis-mongo", "127.0.0.1", "10.0.0.5"]),
        "port": random.choice([3000, 3001, 5432, 27017, 6379, 8080, 8000]),
        "user": random.choice(["root", "aegis_admin", "postgres", "node_runner"]),
        "timeout": random.choice([5000, 10000, 30000]),
        "ip": random.choice(["127.0.0.1", "172.18.0.3", "10.0.5.2"]),
        "query_time": round(random.uniform(5.1, 45.0), 2),
        "variable": random.choice(["config", "authService", "redisClient", "db_pool"]),
        "line": random.randint(10, 500),
        "prop": random.choice(["connect", "length", "split", "execute"]),
        "count": random.randint(4, 15),
        "module": random.choice(["axios", "ioredis", "prisma", "express"]),
        "exit_code": random.choice([1, 2, 127, 139]),
        "rss_gb": round(random.uniform(1.1, 4.8), 2),
        "heap_gb": round(random.uniform(0.9, 3.8), 2),
        "handle_count": random.randint(1000, 8000),
        "leak_mb": random.randint(100, 800),
        "duration": random.choice([60, 120, 300]),
        "filepath": random.choice(["/var/log/app.log", "/var/run/docker.sock", "/app/data/db.sqlite", "/etc/hosts"])
    }
    
    timestamp = f"2026-05-31T01:02:{random.randint(10,59)}Z"
    log_line = f"[{timestamp}] [ERROR] {template.format(**params)}"
    return log_line

def build_dataset(samples_per_class=150):
    dataset = []
    for inc_type, label in CLASSES.items():
        for _ in range(samples_per_class):
            text = generate_log(inc_type)
            dataset.append({"log_text": text, "label": label, "class_name": inc_type})
            
    # Shuffle dataset
    random.shuffle(dataset)
    return dataset

if __name__ == "__main__":
    # Ensure training folder exists
    os.makedirs(os.path.dirname(__file__), exist_ok=True)
    
    output_path = os.path.join(os.path.dirname(__file__), "synthetic_logs.csv")
    print(f"Creating synthetic log dataset at {output_path}...")
    
    data = build_dataset()
    
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["log_text", "label", "class_name"])
        for row in data:
            writer.writerow([row["log_text"], row["label"], row["class_name"]])
            
    print(f"Successfully generated {len(data)} log samples across {len(CLASSES)} classes.")
