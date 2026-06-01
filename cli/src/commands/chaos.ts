const DEFAULT_DEMO_URL = 'http://localhost:3000';

type ChaosMode = 'oom' | 'timeout' | 'port';

const CHAOS_ENDPOINTS: Record<ChaosMode, string> = {
  oom: '/crash/oom',
  timeout: '/crash/timeout',
  port: '/crash/port',
};

function isChaosMode(value: string | undefined): value is ChaosMode {
  return value === 'oom' || value === 'timeout' || value === 'port';
}

export async function runChaosCommand(args: string[]): Promise<void> {
  const mode = isChaosMode(args[0]) ? args[0] : 'oom';
  const baseUrl = process.env.DEMO_SERVICE_URL ?? DEFAULT_DEMO_URL;
  const url = new URL(CHAOS_ENDPOINTS[mode], baseUrl);

  console.log(`[chaos] triggering ${mode} on ${url.toString()}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    const body = await response.text().catch(() => '');
    console.log(`[chaos] response ${response.status}${body ? ` :: ${body}` : ''}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[chaos] request sent or service terminated (${message})`);
  } finally {
    clearTimeout(timeout);
  }
}