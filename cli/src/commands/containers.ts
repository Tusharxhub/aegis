/**
 * Aegis CLI — Containers command
 *
 * Manages monitored containers:
 *   aegis containers list              List all monitored containers
 *   aegis containers inspect <name>    Container details + crash history
 *   aegis containers logs <name>       Recent crash logs
 */

import { log } from '../shared/logger';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

export async function runContainersCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listContainers();
    case 'inspect':
      return inspectContainer(args[1]);
    case 'logs':
      return containerLogs(args[1]);
    default:
      log.error(`Unknown subcommand: ${subcommand}`);
      console.log('  Usage: aegis containers <list|inspect|logs> [name]');
      process.exitCode = 1;
  }
}

async function listContainers(): Promise<void> {
  console.log('');
  console.log('  \x1b[1mAegis Containers\x1b[0m — Monitored Containers');
  console.log('  ──────────────────────────────────────────────');
  console.log('');

  const data = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers`);
  if (!data) {
    log.error('Backend is not reachable at ' + BACKEND_URL);
    log.fix('Start the backend: npm run start:dev');
    return;
  }

  const containers = data.containers as Array<Record<string, unknown>> | undefined;
  if (!containers || containers.length === 0) {
    log.verify('No containers found.');
    return;
  }

  // Filter out aegis infrastructure containers
  const monitored = containers.filter((c) => {
    const names = c.names as string[] ?? [];
    const name = names[0]?.replace(/^\//, '') ?? '';
    return !name.startsWith('aegis-');
  });

  log.verify(`Monitored containers: ${monitored.length}`);
  console.log('');

  for (const c of monitored) {
    const names = c.names as string[] ?? [];
    const name = names[0]?.replace(/^\//, '') ?? 'unknown';
    const state = String(c.state ?? 'unknown');
    const image = String(c.image ?? '');
    const status = String(c.status ?? '');
    const icon = state === 'running' ? '\x1b[32m●\x1b[0m' : state === 'exited' ? '\x1b[31m●\x1b[0m' : '\x1b[33m●\x1b[0m';
    console.log(`    ${icon} ${name}`);
    console.log(`      image:  ${image}`);
    console.log(`      state:  ${state} | ${status}`);
    console.log('');
  }
}

async function inspectContainer(name: string | undefined): Promise<void> {
  if (!name) {
    log.error('Container name required');
    console.log('  Usage: aegis containers inspect <name>');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`  \x1b[1mAegis Inspect\x1b[0m — ${name}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  const data = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers`);
  if (!data) {
    log.error('Backend is not reachable');
    return;
  }

  const containers = data.containers as Array<Record<string, unknown>> ?? [];
  const container = containers.find((c) => {
    const names = c.names as string[] ?? [];
    return names.some((n) => n.replace(/^\//, '') === name);
  });

  if (!container) {
    log.error(`Container "${name}" not found`);
    return;
  }

  const id = String(container.id ?? '');
  const detail = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers/${id}`);
  if (detail && detail.container) {
    const c = detail.container as Record<string, unknown>;
    console.log(`    ID:        ${String(c.id ?? '').slice(0, 12)}`);
    console.log(`    Name:      ${c.name}`);
    console.log(`    Image:     ${c.image}`);
    console.log(`    State:     ${JSON.stringify(c.state)}`);
  }

  // Get service status from incidents
  const incidents = await fetchJson(`${BACKEND_URL}/api/orchestrator/incidents`);
  if (incidents && Array.isArray(incidents.incidents)) {
    const related = (incidents.incidents as Array<Record<string, unknown>>).filter(
      (i) => i.service === id || i.containerName === name,
    );
    if (related.length > 0) {
      console.log('');
      log.verify(`Related incidents: ${related.length}`);
      for (const inc of related.slice(0, 5)) {
        const ts = inc.timestamp ? new Date(inc.timestamp as string).toLocaleTimeString() : 'unknown';
        console.log(`    → [${inc.eventType}] at ${ts} | exit: ${inc.exitCode ?? 'n/a'}`);
      }
    }
  }

  console.log('');
}

async function containerLogs(name: string | undefined): Promise<void> {
  if (!name) {
    log.error('Container name required');
    console.log('  Usage: aegis containers logs <name>');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`  \x1b[1mAegis Logs\x1b[0m — ${name}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  const data = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers`);
  if (!data) {
    log.error('Backend is not reachable');
    return;
  }

  const containers = data.containers as Array<Record<string, unknown>> ?? [];
  const container = containers.find((c) => {
    const names = c.names as string[] ?? [];
    return names.some((n) => n.replace(/^\//, '') === name);
  });

  if (!container) {
    log.error(`Container "${name}" not found`);
    return;
  }

  const id = String(container.id ?? '');
  const logsData = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers/${id}/logs`);
  if (logsData && logsData.logs) {
    console.log(String(logsData.logs));
  } else {
    log.verify('No crash logs available for this container.');
  }

  console.log('');
}
