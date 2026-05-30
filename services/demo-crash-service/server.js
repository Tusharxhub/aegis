const express = require('express');
const app = express();
const port = 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', container: 'demo-crash-service' });
});

// Route 1: OOM Crash Simulation
app.get('/crash/oom', (req, res) => {
  console.error("FATAL ERROR: Java heap space / Node.js process out of memory.");
  console.error("FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory");
  console.error("CRITICAL ERROR: OOM_KILL - Process terminated due to memory pressure.");
  console.error("    at Object.allocateMemory (/app/server.js:15:23)");
  console.error("    at /app/node_modules/express/lib/router/layer.js:95:5");

  // Keep allocating huge arrays in memory
  const memoryLeakStore = [];
  setInterval(() => {
    const chunk = new Array(1e7).fill("OOM_CRASH_SIMULATION_DATA_STREAM_LEAK_HANDLE_TESTING_EXPRESS_ARRAY");
    memoryLeakStore.push(chunk);
  }, 10);
});

// Route 2: Timeout / Connection Lock Simulation
app.get('/crash/timeout', (req, res) => {
  console.error("CRITICAL ERROR: DB_TIMEOUT - Database connection timed out after 30000ms.");
  console.error("Error: Knex: Timeout acquiring a connection. The pool is probably full.");
  console.error("    at DatabaseClient.acquireConnection (/app/src/db/client.js:45:19)");
  console.error("    at processTicksAndRejections (node:internal/process/task_queues:95:5)");
  console.error("    at async /app/server.js:31:18");

  // Block event loop briefly, then exit
  const start = Date.now();
  while (Date.now() - start < 1500) {}
  process.exit(1);
});

// Route 3: Port Collision Simulation
app.get('/crash/port', (req, res) => {
  console.error("CRITICAL ERROR: PORT_COLLISION - Binding address failed; TCP port is already occupied.");
  console.error("Error: listen EADDRINUSE: address already in use :::3000");
  console.error("    at Server.setupListenHandle [as _listen2] (node:net:1897:21)");
  console.error("    at listenInCluster (node:net:1945:12)");
  console.error("    at Server.listen (node:net:2043:7)");
  console.error("    at Function.listen (/app/node_modules/express/lib/application.js:635:24)");

  // Attempt to listen on the occupied port 3000 again to crash Node with EADDRINUSE
  const appCollision = express();
  appCollision.listen(port, () => {
    // Should never be reached
  });
});

app.listen(port, () => {
  console.log(`🚀 Chaos Engineering Crash Target listening on port ${port}`);
});
