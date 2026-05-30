import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SimilarIncident {
  incident_id: string;
  log_text: string;
  label: string;
  score: number;
}

export interface DiagnoseResponse {
  incidentType: string;
  analysis: string;
  confidenceScore: number;
  riskLevel: 'LOW' | 'HIGH';
  suggestedAction: 'RESTART_CONTAINER' | 'STOP_CONTAINER' | 'IGNORE';
  reasoning: string;
  similarIncidents?: SimilarIncident[];
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly aiEngineUrl: string;

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
    this.logger.log(`🧠 Contacting local Custom AI Engine for diagnosis at: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ log_text: logs }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI Engine returned HTTP ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as DiagnoseResponse;
      this.logger.log(`✅ Diagnosis complete: Class [${data.incidentType}] | Suggestion: ${data.suggestedAction} (Confidence: ${data.confidenceScore.toFixed(2)})`);
      return data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Failed to diagnose logs via custom AI Engine: ${message}`);
      
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
}
