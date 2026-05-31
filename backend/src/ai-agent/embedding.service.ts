import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly dimension: number;

  constructor(private readonly configService: ConfigService) {
    this.dimension = parseInt(
      this.configService.get<string>('EMBEDDING_DIMENSION') ?? '384',
      10,
    );
  }

  /**
   * Build a deterministic local embedding vector for log strings.
   * The vector is stable across runs and does not require external services.
   */
  async getEmbedding(text: string): Promise<number[]> {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return new Array(this.dimension).fill(0);
    }

    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = normalized.match(/[a-z0-9_:-]+/g) ?? [normalized];

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = `${tokens[tokenIndex]}:${tokenIndex}`;
      const digest = createHash('sha256').update(token).digest();
      const slot = digest.readUInt32BE(0) % this.dimension;
      const polarity = digest[4] / 255;
      const strength = 0.5 + digest[5] / 255;
      vector[slot] += (polarity > 0.5 ? 1 : -1) * strength;
    }

    const scale = Math.max(tokens.length, 1);
    return vector.map((value) => value / scale);
  }
}
