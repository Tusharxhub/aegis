import { Global, Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module.js';
import { KafkaConfigService } from './kafka.config.js';
import { KafkaHealthService } from './kafka.health.js';
import { KafkaProducerService } from './kafka.producer.js';
import { KafkaConsumerService } from './kafka.consumer.js';

@Global()
@Module({
  imports: [GatewayModule],
  providers: [
    KafkaConfigService,
    KafkaHealthService,
    KafkaProducerService,
    KafkaConsumerService,
  ],
  exports: [
    KafkaConfigService,
    KafkaHealthService,
    KafkaProducerService,
    KafkaConsumerService,
  ],
})
export class KafkaModule {}
