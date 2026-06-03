// ─────────────────────────────────────────────────────────────────────────────
// AI Agent Data Contracts
// Strict schemas enforced on the local AI diagnosis response.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allowed remediation actions.
 * Maps directly to the ActionType and RemediationAction enums.
 */
export type SuggestedActionType =
  | 'RESTART_CONTAINER'
  | 'STOP_CONTAINER'
  | 'IGNORE';

/**
 * The strict JSON response schema from the AI engine.
 * Matches the DiagnoseResponse Pydantic model in the Python service.
 */
export interface AiDiagnosisResult {
  readonly incidentType: string;
  readonly analysis: string;
  readonly confidenceScore: number;
  readonly riskLevel: 'LOW' | 'HIGH';
  readonly suggestedAction: SuggestedActionType;
  readonly reasoning: string;
  readonly embedding?: readonly number[];
  readonly similarIncidents?: ReadonlyArray<{
    readonly incident_id: string;
    readonly log_text: string;
    readonly label: string;
    readonly score: number;
  }>;
}

/**
 * Internal wrapper around the AI response with processing metadata.
 */
export interface AiAnalysisResult {
  readonly response: AiDiagnosisResult | null;
  readonly processingTimeMs: number;
  readonly isValid: boolean;
  readonly validationErrors: readonly string[];
}
