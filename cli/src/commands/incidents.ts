/**
 * Aegis CLI — Incidents command
 *
 * Manages incident inspection:
 *   aegis incidents list              List recent incidents
 *   aegis incidents inspect <id>      Full incident detail
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

export async function runIncidentsCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listIncidents();
    case 'inspect':
      return inspectIncident(args[1]);
    default:
      log.error(`Unknown subcommand: ${subcommand}`);
      console.log('  Usage: aegis incidents <list|inspect> [id]');
      process.exitCode = 1;
  }
}

async function listIncidents(): Promise<void> {
  console.log('');
  console.log('  \x1b[1mAegis Incidents\x1b[0m — Recent Crash Incidents');
  console.log('  ──────────────────────────────────────────────');
  console.log('');

  const data = await fetchJson(`${BACKEND_URL}/api/orchestrator/incidents`);
  if (!data) {
    log.error('Backend is not reachable at ' + BACKEND_URL);
    return;
  }

  const incidents = data.incidents as Array<Record<string, unknown>> | undefined;
  if (!incidents || incidents.length === 0) {
    log.verify('No incidents recorded.');
    return;
  }

  log.verify(`Recent incidents: ${incidents.length}`);
  console.log('');

  for (const inc of incidents) {
    const ts = inc.timestamp ? new Date(inc.timestamp as string).toLocaleString() : 'unknown';
    const eventType = String(inc.eventType ?? 'unknown');
    const exitCode = inc.exitCode ?? 'n/a';
    const id = String(inc.id ?? '').slice(0, 12);
    const preview = String(inc.logsPreview ?? '').slice(0, 80);

    const color = eventType === 'OOM' ? '\x1b[31m' : eventType === 'DIE' ? '\x1b[33m' : '\x1b[36m';
    console.log(`    ${color}[${eventType}]\x1b[0m ${ts}`);
    console.log(`      id: ${id} | exit: ${exitCode}`);
    if (preview) console.log(`      log: ${preview}...`);
    console.log('');
  }
}

async function inspectIncident(id: string | undefined): Promise<void> {
  if (!id) {
    log.error('Incident ID required');
    console.log('  Usage: aegis incidents inspect <id>');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`  \x1b[1mAegis Incident Detail\x1b[0m`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  const data = await fetchJson(`${BACKEND_URL}/api/orchestrator/incidents`);
  if (!data) {
    log.error('Backend is not reachable');
    return;
  }

  const incidents = data.incidents as Array<Record<string, unknown>> ?? [];
  const incident = incidents.find((i) => String(i.id ?? '').startsWith(id));

  if (!incident) {
    log.error(`Incident "${id}" not found`);
    return;
  }

  console.log(`    ID:          ${incident.id}`);
  console.log(`    Event Type:  ${incident.eventType}`);
  console.log(`    Exit Code:   ${incident.exitCode ?? 'n/a'}`);
  console.log(`    Timestamp:   ${incident.timestamp ? new Date(incident.timestamp as string).toLocaleString() : 'unknown'}`);
  console.log(`    Service:     ${incident.service ?? 'unknown'}`);

  const preview = String(incident.logsPreview ?? '');
  if (preview) {
    console.log('');
    console.log('    \x1b[1mLogs Preview:\x1b[0m');
    console.log('    ─────────────');
    console.log(`    ${preview}`);
  }

  // Check for related remediation
  const remediations = await fetchJson(`${BACKEND_URL}/api/orchestrator/remediations`);
  if (remediations && Array.isArray(remediations.remediations)) {
    const related = (remediations.remediations as Array<Record<string, unknown>>).find(
      (r) => r.event === incident.id,
    );
    if (related) {
      console.log('');
      console.log('    \x1b[1mRemediation:\x1b[0m');
      console.log('    ─────────────');
      console.log(`    Action:     ${related.suggestedAction}`);
      console.log(`    Confidence: ${typeof related.confidenceScore === 'number' ? related.confidenceScore.toFixed(2) : 'n/a'}`);
      console.log(`    Risk:       ${related.riskLevel}`);
      console.log(`    Status:     ${related.status}`);
      console.log(`    Reasoning:  ${related.reasoning}`);
    }
  }

  console.log('');
}
