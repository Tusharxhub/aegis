/**
 * Aegis CLI — Dashboard command
 *
 * Live terminal dashboard showing:
 *   - Container status grid
 *   - Recent incidents stream
 *   - Remediation success rate
 *   - Platform health
 *
 * Auto-refreshes every 5 seconds. Press Ctrl+C to exit.
 */

import { log } from '../shared/logger';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BG_DARK = '\x1b[48;5;235m';

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
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

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return ' '.repeat(len - str.length) + str;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function drawHeader(): void {
  console.log('');
  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                    PROJECT AEGIS — LIVE DASHBOARD                    ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
}

function drawSection(title: string): void {
  console.log(`  ${BOLD}${YELLOW}┌─ ${title}${RESET}`);
}

function drawSectionEnd(): void {
  console.log(`  ${YELLOW}└──────────────────────────────────────────────────────────────────────${RESET}`);
  console.log('');
}

export async function runDashboardCommand(): Promise<void> {
  let running = true;

  process.on('SIGINT', () => {
    running = false;
    clearScreen();
    console.log(`${DIM}  Dashboard closed.${RESET}`);
    process.exit(0);
  });

  const refresh = async () => {
    if (!running) return;

    clearScreen();
    drawHeader();

    const timestamp = new Date().toLocaleString();
    console.log(`  ${DIM}Last refresh: ${timestamp} | Press Ctrl+C to exit${RESET}`);
    console.log('');

    // ─── Platform Health ───────────────────────────────────────────
    drawSection('PLATFORM HEALTH');

    const health = await fetchJson(`${BACKEND_URL}/api/health`);
    if (health) {
      const uptime = typeof health.uptime === 'number' ? formatUptime(health.uptime) : 'unknown';
      console.log(`  ${GREEN}●${RESET} Backend:   ${health.status} | Uptime: ${uptime}`);
    } else {
      console.log(`  ${RED}●${RESET} Backend:   unreachable`);
    }

    const kafka = await fetchJson(`${BACKEND_URL}/api/orchestrator/health/kafka`);
    if (kafka) {
      const icon = kafka.status === 'healthy' ? GREEN : kafka.status === 'degraded' ? YELLOW : RED;
      console.log(`  ${icon}●${RESET} Kafka:     ${kafka.status} | Consumer: ${kafka.consumerState ?? 'unknown'}`);
    } else {
      console.log(`  ${RED}●${RESET} Kafka:     unreachable`);
    }

    drawSectionEnd();

    // ─── Container Status ─────────────────────────────────────────
    drawSection('CONTAINERS');

    const containers = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers`);
    if (containers && Array.isArray(containers.containers)) {
      const all = containers.containers as Array<Record<string, unknown>>;
      const monitored = all.filter((c) => {
        const names = c.names as string[] ?? [];
        const name = names[0]?.replace(/^\//, '') ?? '';
        return !name.startsWith('aegis-');
      });

      if (monitored.length === 0) {
        console.log(`  ${DIM}  No monitored containers found.${RESET}`);
      } else {
        console.log(`  ${padRight('NAME', 25)} ${padRight('STATE', 12)} ${padRight('IMAGE', 35)} STATUS`);
        console.log(`  ${DIM}${'─'.repeat(90)}${RESET}`);

        for (const c of monitored) {
          const names = c.names as string[] ?? [];
          const name = padRight(names[0]?.replace(/^\//, '') ?? 'unknown', 25);
          const state = String(c.state ?? 'unknown');
          const stateColor = state === 'running' ? GREEN : state === 'exited' ? RED : YELLOW;
          const stateStr = padRight(`${stateColor}${state}${RESET}`, 12 + stateColor.length + RESET.length);
          const image = padRight(String(c.image ?? '').slice(0, 35), 35);
          const status = String(c.status ?? '');

          console.log(`  ${name} ${stateStr} ${image} ${status}`);
        }
      }
    } else {
      console.log(`  ${RED}  Failed to fetch containers${RESET}`);
    }

    drawSectionEnd();

    // ─── Metrics ──────────────────────────────────────────────────
    drawSection('METRICS');

    const metrics = await fetchJson(`${BACKEND_URL}/api/orchestrator/metrics`);
    if (metrics && metrics.metrics) {
      const m = metrics.metrics as Record<string, unknown>;
      console.log(`  Total Incidents:      ${m.totalIncidents ?? 0}`);
      console.log(`  Remediations:         ${m.completedPlans ?? 0} completed / ${m.failedPlans ?? 0} failed / ${m.skippedPlans ?? 0} skipped`);
      console.log(`  Success Rate:         ${m.remediationSuccessRate ?? '0%'}`);
      console.log(`  Incidents (1h):       ${m.recentIncidents ?? 0}`);
      console.log(`  Monitored Services:   ${m.totalServices ?? 0}`);
    } else {
      console.log(`  ${RED}  Failed to fetch metrics${RESET}`);
    }

    drawSectionEnd();

    // ─── Recent Incidents ─────────────────────────────────────────
    drawSection('RECENT INCIDENTS');

    const incidents = await fetchJson(`${BACKEND_URL}/api/orchestrator/incidents?limit=5`);
    if (incidents && Array.isArray(incidents.incidents) && (incidents.incidents as unknown[]).length > 0) {
      const recent = incidents.incidents as Array<Record<string, unknown>>;
      for (const inc of recent) {
        const ts = inc.timestamp ? new Date(inc.timestamp as string).toLocaleTimeString() : '??';
        const eventType = String(inc.eventType ?? 'unknown');
        const color = eventType === 'OOM' ? RED : eventType === 'DIE' ? YELLOW : CYAN;
        const preview = String(inc.logsPreview ?? '').slice(0, 50);
        console.log(`  ${DIM}${ts}${RESET} ${color}${padRight(eventType, 12)}${RESET} exit:${inc.exitCode ?? 'n/a'} ${DIM}${preview}${RESET}`);
      }
    } else {
      console.log(`  ${DIM}  No recent incidents.${RESET}`);
    }

    drawSectionEnd();

    // ─── Recent Remediations ──────────────────────────────────────
    drawSection('RECENT REMEDIATIONS');

    const remediations = await fetchJson(`${BACKEND_URL}/api/orchestrator/remediations?limit=5`);
    if (remediations && Array.isArray(remediations.remediations) && (remediations.remediations as unknown[]).length > 0) {
      const recent = remediations.remediations as Array<Record<string, unknown>>;
      for (const rem of recent) {
        const action = String(rem.suggestedAction ?? 'unknown');
        const status = String(rem.status ?? 'unknown');
        const confidence = typeof rem.confidenceScore === 'number' ? rem.confidenceScore.toFixed(2) : 'n/a';
        const statusColor = status === 'COMPLETED' ? GREEN : status === 'FAILED' ? RED : status === 'SKIPPED' ? YELLOW : CYAN;
        console.log(`  ${padRight(action, 20)} ${statusColor}${padRight(status, 12)}${RESET} conf:${confidence} risk:${rem.riskLevel ?? 'n/a'}`);
      }
    } else {
      console.log(`  ${DIM}  No recent remediations.${RESET}`);
    }

    drawSectionEnd();

    console.log(`  ${DIM}Auto-refreshing every 5 seconds...${RESET}`);
  };

  // Initial draw
  await refresh();

  // Refresh every 5 seconds
  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      return;
    }
    await refresh();
  }, 5_000);

  // Keep process alive
  await new Promise<void>((resolve) => {
    process.on('exit', () => {
      clearInterval(interval);
      resolve();
    });
  });
}
