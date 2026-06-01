import { existsSync } from 'fs';
import { resolve } from 'path';

const REQUIRED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'KAFKA_BROKER',
  'KAFKA_CLIENT_ID',
  'KAFKA_SSL',
  'DOCKER_SOCKET_PATH',
  'AI_ENGINE_URL',
  'AEGIS_INTERNAL_TOKEN',
  'DEMO_SERVICE_URL',
] as const;

export function getEnvFilePaths(): string[] {
  const candidatePaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'backend/.env'),
    resolve(process.cwd(), 'apps/control-plane/.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
  ];

  const resolvedPaths = new Set<string>();
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      resolvedPaths.add(candidate);
    }
  }

  return Array.from(resolvedPaths);
}

export function validateEnvironmentVariables(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(key);
    }
  }

  const mongoUri =
    typeof env.MONGODB_URI === 'string' && env.MONGODB_URI.trim().length > 0
      ? env.MONGODB_URI.trim()
      : typeof env.MONGO_URI === 'string' && env.MONGO_URI.trim().length > 0
        ? env.MONGO_URI.trim()
        : '';

  if (!mongoUri) {
    missing.push('MONGODB_URI or MONGO_URI');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return env;
}
