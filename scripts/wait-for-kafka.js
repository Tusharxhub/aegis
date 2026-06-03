#!/usr/bin/env node

/**
 * wait-for-kafka.js
 *
 * Waits until the Kafka broker becomes reachable by repeatedly attempting
 * to list topics via the KafkaJS admin client.
 *
 * Usage: node scripts/wait-for-kafka.js
 *
 * Cross-platform: works on Linux, macOS, WSL.
 */

const { Kafka, logLevel } = require('kafkajs');

const BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

async function waitForKafka() {
  console.log(`[wait-for-kafka] Waiting for Kafka broker at ${BROKER}...`);

  const kafka = new Kafka({
    clientId: 'aegis-wait-for-kafka',
    brokers: [BROKER],
    logLevel: logLevel.NOTHING,
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: { retries: 0 },
  });

  const admin = kafka.admin();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      console.log(`[wait-for-kafka] ✓ Kafka is ready (attempt ${attempt}/${MAX_RETRIES})`);
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[wait-for-kafka] Attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);
      try { await admin.disconnect(); } catch { /* ignore */ }

      if (attempt >= MAX_RETRIES) {
        console.error(`[wait-for-kafka] ✗ Kafka did not become ready after ${MAX_RETRIES} attempts.`);
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

waitForKafka();
