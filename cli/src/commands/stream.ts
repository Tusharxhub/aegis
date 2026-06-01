import { Kafka, logLevel } from 'kafkajs';

const TOPICS = [
  'aegis.container.events',
  'aegis.incident.detected',
  'aegis.logs.extracted',
  'aegis.ai.diagnosis.completed',
  'aegis.remediation.started',
  'aegis.remediation.completed',
  'aegis.audit.events',
  'aegis.rl.feedback',
] as const;

function summarizeMessage(raw: string): string {
  if (!raw) {
    return '[empty message]';
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const eventType = typeof parsed.eventType === 'string' ? parsed.eventType : 'event';
    const source = typeof parsed.source === 'string' ? parsed.source : 'unknown';
    const correlationId = typeof parsed.correlationId === 'string' ? parsed.correlationId : 'n/a';
    return `${eventType} :: ${source} :: ${correlationId}`;
  } catch {
    return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  }
}

export async function runStreamCommand(): Promise<void> {
  const broker = process.env.KAFKA_BROKER ?? 'localhost:9092';
  const clientId = process.env.KAFKA_CLIENT_ID ?? 'aegis-cli-stream';
  const kafka = new Kafka({
    clientId,
    brokers: [broker],
    logLevel: logLevel.ERROR,
  });
  const consumer = kafka.consumer({ groupId: 'aegis-cli-stream' });

  await consumer.connect();
  for (const topic of TOPICS) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  console.log(`[stream] connected to ${broker}`);
  console.log(`[stream] listening on ${TOPICS.join(', ')}`);

  const shutdown = async (): Promise<void> => {
    await consumer.disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString('utf8') ?? '';
      const timestamp = message.timestamp ?? new Date().toISOString();
      const summary = summarizeMessage(raw);

      console.log(`[${timestamp}] ${topic}[${partition}] ${summary}`);
    },
  });
}