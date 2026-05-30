const express = require('express');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'demo-crash-service' });
});

// 1. OOM Crash
app.get('/crash/oom', (req, res) => {
  console.error('[FATAL] Triggering OOM crash sequence. Allocating memory rapidly...');
  const oomArray = [];
  res.send('OOM trigger initiated. Check container logs.');
  try {
    while (true) {
      // Allocate 50MB chunks until process dies
      oomArray.push(Buffer.alloc(50 * 1024 * 1024, 'a')); 
    }
  } catch (err) {
    console.error(`[FATAL] OOM failed to crash via allocation, throwing error: ${err.message}`);
    process.exit(137);
  }
});

// 2. Timeout/Lock Crash
app.get('/crash/timeout', (req, res) => {
  console.error('[ERROR] Database connection locked. Query timeout threshold exceeded (30000ms).');
  console.error('[FATAL] Service deadlock detected. Exiting to avoid corruption.');
  res.send('Timeout trigger initiated.');
  setTimeout(() => {
    process.exit(1); // Exit with standard error code
  }, 1000);
});

// 3. Port Binding Conflict Crash
app.get('/crash/port', (req, res) => {
  console.error(`[FATAL] EADDRINUSE: Cannot bind to port ${PORT}. Port is already in use.`);
  res.send('Port conflict trigger initiated.');
  
  // Try to bind a new server to the same port to trigger EADDRINUSE
  const dummyServer = net.createServer();
  dummyServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[FATAL] Address in use, crashing service...`);
      process.exit(1);
    }
  });
  
  setTimeout(() => {
    dummyServer.listen(PORT, '0.0.0.0');
  }, 1000);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo crash service running on port ${PORT}`);
});
