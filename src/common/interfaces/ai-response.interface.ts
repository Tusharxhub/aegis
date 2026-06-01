// ─────────────────────────────────────────────────────────────────────────────
// AI Agent Data Contracts
// Strict schemas enforced on the local AI diagnosis response.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The action types the AI can suggest.
 * Maps directly to the ActionType enum.
 */
export type SuggestedActionType =
  | 'restart'
  | 'scale'
  | 'rollback'
  | 'alert_only'
  | 'resource_limit_adjust';

/**
 * The structured action the AI suggests for remediation.
 */
export interface SuggestedAction {
  readonly type: SuggestedActionType;
  readonly command: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * The strict JSON response schema enforced on the AI model.
 * If the AI's output does not parse into this shape, the remediation is skipped.
 */
export interface AiRemediationResponse {
  readonly analysis: string;
  readonly confidenceScore: number;
  readonly suggestedAction: SuggestedAction;
}

/**
 * Internal wrapper around the AI response with processing metadata.
 */
export interface AiAnalysisResult {
  readonly response: AiRemediationResponse | null;
  readonly rawOutput: string;
  readonly processingTimeMs: number;
  readonly modelUsed: string;
  readonly isValid: boolean;
  readonly validationErrors: readonly string[];
}

/**
 * Local AI API response envelope.
 */
export interface LocalAiApiResponse {
  readonly model: string;
  readonly created_at: string;
  readonly response: string;
  readonly done: boolean;
  readonly done_reason?: string;
  readonly context?: readonly number[];
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}
