import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SimilarIncident {
  readonly incident_id: string;
  readonly log_text: string;
  readonly label: string;
  readonly score: number;
}

export interface DiagnoseResponse {
  readonly incidentType: string;
  readonly analysis: string;
  readonly confidenceScore: number;
  readonly riskLevel: 'LOW' | 'HIGH';
  readonly suggestedAction: 'RESTART_CONTAINER' | 'STOP_CONTAINER' | 'IGNORE';
  readonly reasoning: string;
  readonly similarIncidents?: SimilarIncident[];
  /**
   * The SentenceTransformer embedding vector used during classification.
   * Returned by the AI engine so the orchestrator can persist real vectors
   * instead of synthetic noise. Absent if the AI engine is unreachable.
   */
  readonly embedding?: number[];
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly aiEngineUrl: string;
  private readonly requestTimeoutMs = 15_000;
  private readonly maxRetries = 3;

  constructor(private readonly configService: ConfigService) {
    this.aiEngineUrl =
      this.configService.get<string>('AI_ENGINE_URL') ??
      'http://aegis-ai-engine:8000';
  }

  /**
   * Post container crash logs to the local custom AI microservice for diagnosis.
   */
  async diagnoseLogs(logs: string): Promise<DiagnoseResponse> {
    const url = `${this.aiEngineUrl}/diagnose`;
    this.logger.log(
      `🧠 Contacting local Custom AI Engine for diagnosis at: ${url}`,
    );

    try {
      const data = await this.requestDiagnosis(url, logs);
      this.logger.log(
        `✅ Diagnosis complete: Class [${data.incidentType}] | Suggestion: ${data.suggestedAction} (Confidence: ${data.confidenceScore.toFixed(2)})`,
      );
      return data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `❌ Failed to diagnose logs via custom AI Engine: ${message}`,
      );

      // Strict safety fallback: Do not perform automatic remediation
      return {
        incidentType: 'UNKNOWN_FAILURE',
        analysis: 'Inference pipeline failure. Unable to parse container logs.',
        confidenceScore: 0.0,
        riskLevel: 'HIGH',
        suggestedAction: 'IGNORE',
        reasoning: `AI client connectivity error: ${message}`,
        similarIncidents: [],
      };
    }
  }

  private async requestDiagnosis(
    url: string,
    logs: string,
  ): Promise<DiagnoseResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ log_text: logs }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `AI Engine returned HTTP ${response.status}: ${errorBody}`,
          );
        }

        return (await response.json()) as DiagnoseResponse;
      } catch (error: unknown) {
        lastError = error;
        const message =
          error instanceof Error && error.name === 'AbortError'
            ? `timed out after ${this.requestTimeoutMs}ms`
            : error instanceof Error
              ? error.message
              : String(error);

        if (attempt >= this.maxRetries) {
          throw new Error(message);
        }

        this.logger.warn(
          `AI Engine request failed on attempt ${attempt}/${this.maxRetries}: ${message}. Retrying...`,
        );
        await this.sleep(250 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('AI Engine request failed unexpectedly');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
