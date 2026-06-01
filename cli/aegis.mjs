#!/usr/bin/env node

/**
 * aegis — Project Aegis CLI
 *
 * Commands:
 *   cluster up       Start infrastructure (docker compose)
 *   cluster down     Stop infrastructure
 *   cluster status   Show cluster status
 *   chaos oom        Trigger OOM on crash simulator
 *   chaos timeout    Trigger timeout crash
 *   chaos port       Trigger port collision crash
 *   stream           Tail Kafka event stream (not yet implemented)
 *   health           Show control plane health
 *   train            Kick off RL agent training
 */

import { execSync, spawn } from 'child_process';
import { argv, exit } from 'process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COMPOSE_FILE = resolve(ROOT, 'docker-compose.yml');
const AI_ENGINE_DIR = resolve(ROOT, 'services', 'ai-engine');
const RL_LAB_DIR = resolve(ROOT, 'services', 'rl-lab');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

function banner() {
  console.log(`${CYAN}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🛡️  aegis — Project Aegis CLI                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`${NC}`);
}

function help() {
  banner();
  console.log('Usage: aegis <command> [args]\n');
  console.log('Commands:');
  console.log('  cluster up         Start infrastructure (Kafka + MongoDB)');
  console.log('  cluster down       Stop infrastructure');
  console.log('  cluster status     Show container status');
  console.log('  cluster logs       Tail infrastructure logs');
  console.log('  chaos oom          Trigger OOM crash on demo service');
  console.log('  chaos timeout      Trigger timeout crash on demo service');
  console.log('  chaos port         Trigger port collision crash');
  console.log('  health             Show control plane health');
  console.log('  train              Train RL agent offline');
  console.log('  stream             Tail Kafka event stream');
  console.log('');
}

function exec(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
  } catch (err) {
    console.error(`${RED}Command failed: ${cmd}${NC}`);
    exit(1);
  }
}

async function fetchJson(url) {
  try {
    const resp = await fetch(url);
    return await resp.json();
  } catch (err) {
    console.error(`${RED}Failed to connect to ${url}: ${err.message}${NC}`);
    return null;
  }
}

async function main() {
  const args = argv.slice(2);
  if (args.length === 0) return help();
  const cmd = args.slice(0, 2).join(' ');

  switch (cmd) {
    case 'cluster up':
      banner();
      console.log(`${GREEN}Starting Aegis infrastructure...${NC}`);
      exec(`docker compose -f ${COMPOSE_FILE} up -d aegis-kafka aegis-mongodb`);
      console.log(`${GREEN}✓ Infrastructure started.${NC}`);
      break;

    case 'cluster down':
      banner();
      console.log(`${YELLOW}Stopping Aegis infrastructure...${NC}`);
      exec(`docker compose -f ${COMPOSE_FILE} down`);
      console.log(`${GREEN}✓ Infrastructure stopped.${NC}`);
      break;

    case 'cluster status':
      banner();
      exec(`docker compose -f ${COMPOSE_FILE} ps`);
      break;

    case 'cluster logs':
      exec(`docker compose -f ${COMPOSE_FILE} logs -f --tail=50`);
      break;

    case 'chaos oom':
      banner();
      console.log(`${RED}🔥 Triggering OOM crash on demo service...${NC}`);
      await fetchJson('http://localhost:3099/crash/oom');
      console.log(`${GREEN}✓ OOM crash triggered.${NC}`);
      break;

    case 'chaos timeout':
      banner();
      console.log(`${RED}🔥 Triggering timeout crash on demo service...${NC}`);
      await fetchJson('http://localhost:3099/crash/timeout');
      console.log(`${GREEN}✓ Timeout crash triggered.${NC}`);
      break;

    case 'chaos port':
      banner();
      console.log(`${RED}🔥 Triggering port collision on demo service...${NC}`);
      await fetchJson('http://localhost:3099/crash/port');
      console.log(`${GREEN}✓ Port collision triggered.${NC}`);
      break;

    case 'health':
    case 'health check':
      banner();
      const healthData = await fetchJson('http://localhost:4000/health');
      if (healthData) {
        console.log(`${GREEN}Control Plane Status:${NC}`);
        console.log(JSON.stringify(healthData, null, 2));
      }
      break;

    case 'train':
    case 'train agent':
      banner();
      console.log(`${CYAN}Starting RL agent training...${NC}`);
      exec(`python3 train_agent.py`, { cwd: RL_LAB_DIR });
      break;

    case 'stream':
      banner();
      console.log(`${YELLOW}Kafka stream tailing is not yet implemented.${NC}`);
      console.log('Use: docker exec aegis-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic aegis.container.events');
      break;

    default:
      console.error(`${RED}Unknown command: ${cmd}${NC}`);
      help();
      exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}CLI error: ${err.message}${NC}`);
  exit(1);
});
