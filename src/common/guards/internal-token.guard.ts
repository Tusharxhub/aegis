import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * InternalTokenGuard — protects dangerous endpoints (restart, chaos).
 * Validates the `x-aegis-token` header against AEGIS_INTERNAL_TOKEN env var.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);
  private readonly expectedToken: string;

  constructor(private readonly configService: ConfigService) {
    this.expectedToken =
      this.configService.get<string>('AEGIS_INTERNAL_TOKEN') ??
      'aegis-dev-token';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-aegis-token'] as string | undefined;

    if (!token || token !== this.expectedToken) {
      this.logger.warn(`Unauthorized request to ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid or missing x-aegis-token header.');
    }

    return true;
  }
}
