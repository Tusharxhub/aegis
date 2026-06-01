import { runChaosCommand } from './commands/chaos.ts';
import { runStreamCommand } from './commands/stream.ts';

function printHelp(): void {
  console.log('Usage: npm run cli -- <command> [args]');
  console.log('');
  console.log('Commands:');
  console.log('  stream           Stream Kafka telemetry to the terminal');
  console.log('  chaos [mode]     Trigger a crash-service endpoint (oom|timeout|port)');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'stream':
      await runStreamCommand();
      return;
    case 'chaos':
      await runChaosCommand(args);
      return;
    default:
      printHelp();
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[aegis-cli] ${message}`);
  process.exit(1);
});