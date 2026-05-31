/**
 * Project Aegis — MongoDB Initialization Script
 *
 * Executed once on first container startup via MONGO_INITDB_* environment vars
 * or by mounting this file into the container's /docker-entrypoint-initdb.d/ directory.
 *
 * Creates the aegis database, indexes, and TTL expiration policies.
 */

// Switch to (or create) the aegis database
const db = db.getSiblingDB('aegis');

print('[AEGIS-INIT] Creating collections and indexes...');

// ─── services ────────────────────────────────────────────────────────────────
db.createCollection('services');
db.services.createIndex({ containerId: 1 }, { unique: true, name: 'idx_containerId_unique' });
db.services.createIndex({ status: 1 }, { name: 'idx_status' });
db.services.createIndex({ lastSeenAt: -1 }, { name: 'idx_lastSeenAt' });

// ─── infrastructureevents ─────────────────────────────────────────────────────
db.createCollection('infrastructureevents');
db.infrastructureevents.createIndex({ service: 1 }, { name: 'idx_service' });
db.infrastructureevents.createIndex({ eventType: 1 }, { name: 'idx_eventType' });
db.infrastructureevents.createIndex({ timestamp: -1 }, { name: 'idx_timestamp' });
db.infrastructureevents.createIndex(
  { service: 1, eventType: 1, timestamp: -1 },
  { name: 'idx_service_event_timestamp' },
);
// TTL: auto-expire raw incident records after 90 days to bound storage
db.infrastructureevents.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000, name: 'ttl_90d' },
);

// ─── incidentembeddings ──────────────────────────────────────────────────────
db.createCollection('incidentembeddings');
db.incidentembeddings.createIndex({ event: 1 }, { unique: true, name: 'idx_event_unique' });
db.incidentembeddings.createIndex({ incidentType: 1 }, { name: 'idx_incidentType' });
// TTL: expire embedding records after 180 days; RL training data is refreshed
db.incidentembeddings.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 15552000, name: 'ttl_180d' },
);

// ─── remediationplans ─────────────────────────────────────────────────────────
db.createCollection('remediationplans');
db.remediationplans.createIndex({ event: 1 }, { name: 'idx_event' });
db.remediationplans.createIndex({ status: 1 }, { name: 'idx_status' });
db.remediationplans.createIndex({ createdAt: -1 }, { name: 'idx_createdAt' });

// ─── actionexecutions ─────────────────────────────────────────────────────────
db.createCollection('actionexecutions');
db.actionexecutions.createIndex({ plan: 1 }, { name: 'idx_plan' });
db.actionexecutions.createIndex({ isSuccessful: 1 }, { name: 'idx_isSuccessful' });

// ─── episodes (RL replay buffer) ─────────────────────────────────────────────
db.createCollection('episodes');
db.episodes.createIndex({ timestamp: -1 }, { name: 'idx_timestamp' });
db.episodes.createIndex({ containerName: 1 }, { name: 'idx_containerName' });
// TTL: keep replay buffer for 365 days then auto-expire
db.episodes.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 31536000, name: 'ttl_365d' },
);

print('[AEGIS-INIT] Indexes created successfully.');
print('[AEGIS-INIT] Project Aegis database initialized.');
