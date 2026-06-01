const REQUIRED_ENV_KEYS = [
  'NODE_ENV',
  'BACKEND_PORT',
  'KAFKA_BROKER',
  'KAFKA_CLIENT_ID',
  'AI_ENGINE_URL',
  'MONGODB_URI',
] as const;

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

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return env;
}
