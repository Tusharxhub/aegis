import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly ollamaUrl: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.ollamaUrl =
      this.configService.get<string>('OLLAMA_API_URL') ??
      'http://aegis-ollama:11434';
    this.model =
      this.configService.get<string>('OLLAMA_EMBEDDING_MODEL') ?? 'all-minilm';
  }

  /**
   * Request embedding vector for log strings from local Ollama.
   * If the service is loading/offline, falls back to a 384-dimension zero vector.
   */
  async getEmbedding(text: string): Promise<number[]> {
    const url = `${this.ollamaUrl}/api/embeddings`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Ollama Embedding API returned HTTP ${response.status}: ${errorBody}`,
        );
      }

      const data = (await response.json()) as { embedding: number[] };
      return data.embedding;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `❌ Failed to fetch embedding from local Ollama: ${message}`,
      );

      // Standalone fallback to prevent whole loop crashes
      this.logger.warn(
        '⚠️ Returning fallback 384-dimension zero-vector to keep the MDP loop active.',
      );
      return new Array(384).fill(0);
    }
  }
}
