import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiRemediationResponse,
  AiAnalysisResult,
  OllamaApiResponse,
} from '../common/interfaces/ai-response.interface.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';
import { OLLAMA_REQUEST_TIMEOUT_MS } from '../common/constants/index.js';

/**
 * AiAgentService — The SRE Brain.
 *
 * Formats Docker crash logs into a structured prompt, sends it to a local
 * Ollama instance running qwen2.5-coder, and enforces a strict JSON response
 * schema: { analysis, confidenceScore, suggestedAction }.
 *
 * The AI WILL hallucinate JSON occasionally. Every response is wrapped in
 * try/catch with structural validation. Invalid responses are marked as
 * failed with full validation error details.
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly ollamaUrl: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.ollamaUrl =
      this.configService.get<string>('OLLAMA_API_URL') ??
      'http://localhost:11434';
    this.model =
      this.configService.get<string>('OLLAMA_MODEL') ?? 'qwen2.5-coder';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Analyze a container crash event using the local AI model.
   * Returns a validated AiAnalysisResult with the parsed response or
   * validation errors if the AI output was malformed.
   */
  async analyzeCrashEvent(
    event: DockerCrashEvent,
  ): Promise<AiAnalysisResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildSystemPrompt(event);
      const rawOutput = await this.callOllama(prompt);
      const processingTimeMs = Date.now() - startTime;

      // Attempt to parse the AI's JSON response
      const parseResult = this.parseAndValidateResponse(rawOutput);

      if (parseResult.isValid && parseResult.response) {
        this.logger.log(
          `🧠 AI analysis complete — confidence: ${parseResult.response.confidenceScore}, action: ${parseResult.response.suggestedAction.type} (${processingTimeMs}ms)`,
        );
      } else {
        this.logger.warn(
          `⚠️  AI response validation failed: ${parseResult.errors.join(', ')}`,
        );
      }

      return {
        response: parseResult.response,
        rawOutput,
        processingTimeMs,
        modelUsed: this.model,
        isValid: parseResult.isValid,
        validationErrors: parseResult.errors,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown AI service error';
      const processingTimeMs = Date.now() - startTime;

      this.logger.error(`❌ AI analysis failed: ${message}`);

      return {
        response: null,
        rawOutput: '',
        processingTimeMs,
        modelUsed: this.model,
        isValid: false,
        validationErrors: [message],
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // System Prompt Construction
  // ─────────────────────────────────────────────────────────────────────────

  private buildSystemPrompt(event: DockerCrashEvent): string {
    return `You are a Senior Site Reliability Engineer (SRE) AI agent for Project Aegis, an autonomous infrastructure management system. Your job is to analyze container crash events and produce a remediation plan.

## CONTEXT
A Docker container has crashed. Here are the details:

- **Container Name**: ${event.containerName}
- **Image**: ${event.imageName}
- **Event Type**: ${event.eventType}
- **Exit Code**: ${event.exitCode}
- **Timestamp**: ${event.timestamp.toISOString()}

## CRASH LOGS (last ${MAX_LOG_LINES_FOR_PROMPT} lines)
\`\`\`
${event.logs}
\`\`\`

## EXIT CODE REFERENCE
- Exit 0: Normal shutdown (no action needed)
- Exit 1: Application error
- Exit 137: SIGKILL (OOM kill or docker kill)
- Exit 139: SIGSEGV (segmentation fault)
- Exit 143: SIGTERM (graceful shutdown request)

## YOUR TASK
Analyze the crash logs and exit code. Determine:
1. The root cause of the crash.
2. Your confidence level in the analysis (0.0 to 1.0).
3. The best remediation action.

## RESPONSE FORMAT
You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON:

{
  "analysis": "A detailed 2-3 sentence analysis of the root cause based on the logs and exit code.",
  "confidenceScore": 0.85,
  "suggestedAction": {
    "type": "restart",
    "command": "docker restart <container_id>",
    "parameters": {
      "timeout": 10,
      "reason": "Brief reason for this action"
    }
  }
}

## ACTION TYPES
- "restart": Restart the container (most common for transient failures)
- "scale": Scale horizontally (for resource exhaustion)  
- "rollback": Rollback to previous image version (for deployment failures)
- "alert_only": Only alert operators, do not auto-remediate (for unknown issues)
- "resource_limit_adjust": Adjust memory/CPU limits (for OOM kills)

## RULES
- confidenceScore MUST be a number between 0.0 and 1.0
- If you are unsure, set confidenceScore below 0.5 and use "alert_only"
- For OOM kills (exit 137), always consider "resource_limit_adjust"
- NEVER suggest destructive actions like container removal`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ollama HTTP Client
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Call the local Ollama API with the constructed prompt.
   * Uses the /api/generate endpoint with JSON format enforcement.
   */
  private async callOllama(prompt: string): Promise<string> {
    const url = `${this.ollamaUrl}/api/generate`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      OLLAMA_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          format: 'json',
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
            num_predict: 1024,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Ollama API returned ${response.status}: ${errorBody}`,
        );
      }

      const data = (await response.json()) as OllamaApiResponse;
      return data.response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Ollama request timed out after ${OLLAMA_REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Response Validation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse and structurally validate the AI's JSON response.
   * The AI WILL produce malformed JSON sometimes — this is the safety net.
   */
  private parseAndValidateResponse(raw: string): {
    isValid: boolean;
    response: AiRemediationResponse | null;
    errors: string[];
  } {
    const errors: string[] = [];

    // Step 1: Try to extract JSON from potential markdown/text wrapping
    let jsonStr = raw.trim();

    // Handle cases where AI wraps JSON in code fences
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Step 2: Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      errors.push(`JSON parse error: response is not valid JSON`);
      return { isValid: false, response: null, errors };
    }

    // Step 3: Validate required fields
    if (typeof parsed.analysis !== 'string' || parsed.analysis.length === 0) {
      errors.push('"analysis" must be a non-empty string');
    }

    if (
      typeof parsed.confidenceScore !== 'number' ||
      parsed.confidenceScore < 0 ||
      parsed.confidenceScore > 1
    ) {
      errors.push('"confidenceScore" must be a number between 0.0 and 1.0');
    }

    if (
      typeof parsed.suggestedAction !== 'object' ||
      parsed.suggestedAction === null
    ) {
      errors.push('"suggestedAction" must be an object');
    } else {
      const action = parsed.suggestedAction as Record<string, unknown>;
      const validTypes = [
        'restart',
        'scale',
        'rollback',
        'alert_only',
        'resource_limit_adjust',
      ];

      if (typeof action.type !== 'string' || !validTypes.includes(action.type)) {
        errors.push(
          `"suggestedAction.type" must be one of: ${validTypes.join(', ')}`,
        );
      }

      if (typeof action.command !== 'string') {
        errors.push('"suggestedAction.command" must be a string');
      }

      if (typeof action.parameters !== 'object' || action.parameters === null) {
        errors.push('"suggestedAction.parameters" must be an object');
      }
    }

    if (errors.length > 0) {
      return { isValid: false, response: null, errors };
    }

    return {
      isValid: true,
      response: parsed as unknown as AiRemediationResponse,
      errors: [],
    };
  }
}

/** Maximum log lines referenced in the prompt text */
const MAX_LOG_LINES_FOR_PROMPT = 100;
