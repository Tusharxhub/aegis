import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * InternalTokenGuard — protects dangerous endpoints (restart, chaos).
 * Validates the `x-aegis-token` header against AEGIS_INTERNAL_TOKEN env var.
 *
 * Security hardening:
 *   - No hardcoded fallback token — rejects all requests if unconfigured.
 *   - Uses crypto.timingSafeEqual() to prevent timing attacks.
 *   - Auto-generates a secure token if not configured and logs it once.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);
  private readonly expectedToken: string;

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.get<string>('AEGIS_INTERNAL_TOKEN');

    if (configured && configured.trim().length > 0) {
      this.expectedToken = configured.trim();
    } else {
      // Generate a cryptographically random token for this session
      this.expectedToken = randomBytes(32).toString('hex');
      this.logger.warn(
        `[SECURITY] AEGIS_INTERNAL_TOKEN is not set. Generated session token: ${this.expectedToken}`,
      );
      this.logger.warn(
        '[SECURITY] Set AEGIS_INTERNAL_TOKEN in .env to use a persistent token.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-aegis-token'] as string | undefined;

    if (!token || !this.safeCompare(token, this.expectedToken)) {
      this.logger.warn(
        `Unauthorized request to ${request.method} ${request.url}`,
      );
      throw new UnauthorizedException(
        'Invalid or missing x-aegis-token header.',
      );
    }

    return true;
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Both strings are padded to the same length before comparison.
   */
  private safeCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');

    // timingSafeEqual requires equal-length buffers
    if (aBuf.length !== bBuf.length) {
      // Still perform a comparison to avoid leaking length information via timing
      const padded = Buffer.alloc(bBuf.length);
      aBuf.copy(padded, 0, 0, Math.min(aBuf.length, bBuf.length));
      timingSafeEqual(padded, bBuf);
      return false;
    }

    return timingSafeEqual(aBuf, bBuf);
  }
}
