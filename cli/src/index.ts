#!/usr/bin/env node

/**
 * Aegis CLI — Entry point
 *
 * Terminal-native CLI for the Aegis AIOps platform.
 * Provides chaos engineering, Kafka streaming, infrastructure
 * diagnostics, container management, and platform status commands.
 *
 * Commands:
 *   aegis doctor                  Infrastructure health check
 *   aegis status                  Platform snapshot
 *   aegis stream                  Stream Kafka telemetry
 *   aegis chaos <mode>            Trigger chaos test
 *     modes: oom | timeout | crash | permission | port
 *   aegis containers <sub>        Container management
 *     sub: list | inspect | logs
 *   aegis incidents <sub>         Incident management
 *     sub: list | inspect
 *   aegis exclude <sub>           Exclusion list management
 *     sub: list | add | remove
 *   aegis dashboard               Live terminal dashboard
 */

import { runChaosCommand } from './commands/chaos';
import { runStreamCommand } from './commands/stream';
import { runDoctorCommand } from './commands/doctor';
import { runStatusCommand } from './commands/status';
import { runContainersCommand } from './commands/containers';
import { runIncidentsCommand } from './commands/incidents';
import { runExcludeCommand } from './commands/exclude';
import { runDashboardCommand } from './commands/dashboard';
import { log } from './shared/logger';

function printHelp(): void {
  console.log('');
  console.log('  \x1b[1mAegis CLI\x1b[0m — AIOps Platform Management');
  console.log('');
  console.log('  \x1b[1mUsage:\x1b[0m aegis <command> [options]');
  console.log('');
  console.log('  \x1b[1mCore Commands:\x1b[0m');
  console.log('    doctor             Run infrastructure health check');
  console.log('    status             Display platform snapshot');
  console.log('    stream             Stream Kafka telemetry to the terminal');
  console.log('    dashboard          Live terminal dashboard');
  console.log('');
  console.log('  \x1b[1mContainer Management:\x1b[0m');
  console.log('    containers list    List all monitored containers');
  console.log('    containers inspect Container details and crash history');
  console.log('    containers logs    View recent crash logs');
  console.log('');
  console.log('  \x1b[1mIncident Management:\x1b[0m');
  console.log('    incidents list     List recent incidents');
  console.log('    incidents inspect  Full incident detail');
  console.log('');
  console.log('  \x1b[1mConfiguration:\x1b[0m');
  console.log('    exclude list       List excluded containers');
  console.log('    exclude add        Add container to exclusion list');
  console.log('    exclude remove     Remove from exclusion list');
  console.log('');
  console.log('  \x1b[1mChaos Engineering:\x1b[0m');
  console.log('    chaos [mode]       Trigger a chaos test');
  console.log('                       modes: oom | timeout | crash | permission | port');
  console.log('');
  console.log('  \x1b[1mOptions:\x1b[0m');
  console.log('    --debug            Show verbose debug output');
  console.log('    --help, -h         Show this help message');
  console.log('');
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];
  const args = rawArgs.slice(1);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exitCode = 0;
    return;
  }

  switch (command) {
    case 'doctor':
      await runDoctorCommand();
      return;
    case 'status':
      await runStatusCommand();
      return;
    case 'stream':
      await runStreamCommand();
      return;
    case 'chaos':
      await runChaosCommand(args);
      return;
    case 'containers':
      await runContainersCommand(args);
      return;
    case 'incidents':
      await runIncidentsCommand(args);
      return;
    case 'exclude':
      await runExcludeCommand(args);
      return;
    case 'dashboard':
      await runDashboardCommand();
      return;
    default:
      log.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (process.argv.includes('--debug')) {
    console.error(error);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
  }
  process.exit(1);
});
