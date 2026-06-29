/**
 * Aegis CLI — Exclude command
 *
 * Manages container exclusion list:
 *   aegis exclude list                List excluded containers
 *   aegis exclude add <name>          Add container to exclusion list
 *   aegis exclude remove <name>       Remove container from exclusion list
 *
 * Exclusions are persisted in .env via AEGIS_EXTRA_IGNORED_CONTAINERS.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { log } from '../shared/logger';

const ENV_PATH = resolve(process.cwd(), '.env');

function readEnv(): Record<string, string> {
  try {
    const content = readFileSync(ENV_PATH, 'utf8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
    return env;
  } catch {
    return {};
  }
}

function writeEnv(env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

function getExtraIgnored(env: Record<string, string>): string[] {
  const raw = env['AEGIS_EXTRA_IGNORED_CONTAINERS'] ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function setExtraIgnored(env: Record<string, string>, list: string[]): Record<string, string> {
  env['AEGIS_EXTRA_IGNORED_CONTAINERS'] = list.join(',');
  return env;
}

export async function runExcludeCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listExclusions();
    case 'add':
      return addExclusion(args[1]);
    case 'remove':
      return removeExclusion(args[1]);
    default:
      log.error(`Unknown subcommand: ${subcommand}`);
      console.log('  Usage: aegis exclude <list|add|remove> [name]');
      process.exitCode = 1;
  }
}

function listExclusions(): void {
  console.log('');
  console.log('  \x1b[1mAegis Exclusions\x1b[0m — Container Exclusion List');
  console.log('  ──────────────────────────────────────────────────');
  console.log('');

  const env = readEnv();
  const extras = getExtraIgnored(env);

  console.log('    \x1b[1mHardcoded (aegis infra):\x1b[0m');
  console.log('      aegis-mongodb, aegis-kafka, aegis-kafka-ui, aegis-ai-engine, aegis-control-plane');
  console.log('      (all containers prefixed "aegis-" are auto-excluded)');
  console.log('');

  if (extras.length > 0) {
    console.log('    \x1b[1mCustom exclusions (from .env):\x1b[0m');
    for (const name of extras) {
      console.log(`      - ${name}`);
    }
  } else {
    log.verify('No custom exclusions configured.');
  }

  console.log('');
  console.log('  \x1b[2mTip: Use "aegis exclude add <name>" to exclude a container.\x1b[0m');
  console.log('  \x1b[2mTip: Add label "aegis.monitor=false" to opt out via Docker.\x1b[0m');
  console.log('');
}

function addExclusion(name: string | undefined): void {
  if (!name) {
    log.error('Container name required');
    console.log('  Usage: aegis exclude add <name>');
    process.exitCode = 1;
    return;
  }

  const normalized = name.trim().replace(/^\/+/, '');

  if (normalized.startsWith('aegis-')) {
    log.fix(`"${normalized}" is already excluded by prefix rule (all aegis-* containers are auto-excluded).`);
    return;
  }

  const env = readEnv();
  const extras = getExtraIgnored(env);

  if (extras.includes(normalized)) {
    log.verify(`"${normalized}" is already in the exclusion list.`);
    return;
  }

  extras.push(normalized);
  writeEnv(setExtraIgnored(env, extras));

  log.success(`Added "${normalized}" to exclusion list.`);
  console.log('  \x1b[2mRestart the backend for changes to take effect.\x1b[0m');
  console.log('');
}

function removeExclusion(name: string | undefined): void {
  if (!name) {
    log.error('Container name required');
    console.log('  Usage: aegis exclude remove <name>');
    process.exitCode = 1;
    return;
  }

  const normalized = name.trim().replace(/^\/+/, '');
  const env = readEnv();
  const extras = getExtraIgnored(env);

  const idx = extras.indexOf(normalized);
  if (idx === -1) {
    log.error(`"${normalized}" is not in the custom exclusion list.`);
    return;
  }

  extras.splice(idx, 1);
  writeEnv(setExtraIgnored(env, extras));

  log.success(`Removed "${normalized}" from exclusion list.`);
  console.log('  \x1b[2mRestart the backend for changes to take effect.\x1b[0m');
  console.log('');
}
