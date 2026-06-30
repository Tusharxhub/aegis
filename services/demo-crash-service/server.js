const express = require('express');
const app = express();
const port = 3000;

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    service: 'demo-crash-service',
    purpose: 'Chaos engineering crash target for Project Aegis',
    routes: ['/health', '/crash', '/crash/oom', '/crash/timeout', '/crash/permission', '/crash/port'],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', container: 'demo-crash-service', uptime: process.uptime() });
});

// ── Crash Routes ──────────────────────────────────────────────────────────────

// Route 1: General process crash
app.get('/crash', (req, res) => {
  console.error('FATAL ERROR: Uncaught exception — process exiting.');
  console.error('Error: Application encountered an unrecoverable state.');
  console.error('    at Object.<anonymous> (/app/server.js:22:7)');
  console.error('    at Module._compile (node:internal/modules/cjs/loader:1469:14)');
  process.exit(1);
});

// Route 2: OOM crash simulation
app.get('/crash/oom', (req, res) => {
  console.error('FATAL ERROR: Java heap space / Node.js process out of memory.');
  console.error('FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory');
  console.error('CRITICAL ERROR: OOM_KILL - Process terminated due to memory pressure.');
  console.error('    at Object.allocateMemory (/app/server.js:15:23)');
  console.error('    at /app/node_modules/express/lib/router/layer.js:95:5');

  const memoryLeakStore = [];
  setInterval(() => {
    const chunk = new Array(1e7).fill('OOM_CRASH_SIMULATION_DATA_STREAM_LEAK_HANDLE_TESTING_EXPRESS_ARRAY');
    memoryLeakStore.push(chunk);
  }, 10);
});

// Route 3: Timeout / connection lock simulation
app.get('/crash/timeout', (req, res) => {
  console.error('CRITICAL ERROR: DB_TIMEOUT - Database connection timed out after 30000ms.');
  console.error('Error: Knex: Timeout acquiring a connection. The pool is probably full.');
  console.error('    at DatabaseClient.acquireConnection (/app/src/db/client.js:45:19)');
  console.error('    at processTicksAndRejections (node:internal/process/task_queues:95:5)');
  console.error('    at async /app/server.js:31:18');

  const start = Date.now();
  while (Date.now() - start < 1500) {}
  process.exit(1);
});

// Route 4: Permission denied simulation
app.get('/crash/permission', (req, res) => {
  console.error('CRITICAL ERROR: PERMISSION_DENIED - File system access denied.');
  console.error('Error: EACCES: permission denied, open \'/etc/shadow\'');
  console.error('    at Object.openSync (node:fs:601:3)');
  console.error('    at Object.readFileSync (node:fs:471:35)');
  console.error('    at /app/server.js:45:10');
  console.error('Error: Operation not permitted — container lacks CAP_SYS_ADMIN capability.');

  setTimeout(() => process.exit(1), 200);
});

// Route 5: Port collision simulation
app.get('/crash/port', (req, res) => {
  console.error('CRITICAL ERROR: PORT_COLLISION - Binding address failed; TCP port is already occupied.');
  console.error('Error: listen EADDRINUSE: address already in use :::3000');
  console.error('    at Server.setupListenHandle [as _listen2] (node:net:1897:21)');
  console.error('    at listenInCluster (node:net:1945:12)');
  console.error('    at Server.listen (node:net:2043:7)');
  console.error('    at Function.listen (/app/node_modules/express/lib/application.js:635:24)');

  // Attempt to listen on the occupied port again to crash with EADDRINUSE
  const http = require('http');
  const server = http.createServer();
  server.on('error', (err) => {
    console.error(`Port collision error: ${err.message}`);
    process.exit(1);
  });
  server.listen(port);
});

app.listen(port, () => {
  console.log(`🚀 Chaos Engineering Crash Target listening on port ${port}`);
});
