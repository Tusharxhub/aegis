import { Module } from '@nestjs/common';
import { AegisGateway } from './events.gateway.js';

@Module({
  providers: [AegisGateway],
  exports: [AegisGateway],
})
export class GatewayModule {}
