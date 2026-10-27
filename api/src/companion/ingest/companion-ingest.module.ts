import { Module } from '@nestjs/common';
import { CompanionDevicesModule } from '../devices/companion-devices.module';
import { CompanionHandlerRegistry } from './companion-handler.registry';
import {
  CompanionIngestAuthGuard,
  CompanionSessionJwtGuard,
} from './companion-ingest-auth.guard';
import { CompanionIngestLatestRepository } from './companion-ingest-latest.repository';
import { CompanionIngestRateLimitGuard } from './companion-ingest-rate-limit.guard';
import { CompanionIngestController } from './companion-ingest.controller';
import { CompanionIngestService } from './companion-ingest.service';

/**
 * ROK-1956: the companion messages route + the handler registry. Plugins
 * import this module and call `CompanionHandlerRegistry.register` from
 * their `onModuleInit`. No production handler ships here (D-4).
 */
@Module({
  imports: [CompanionDevicesModule],
  controllers: [CompanionIngestController],
  providers: [
    CompanionHandlerRegistry,
    CompanionIngestAuthGuard,
    CompanionSessionJwtGuard,
    CompanionIngestRateLimitGuard,
    CompanionIngestLatestRepository,
    CompanionIngestService,
  ],
  exports: [CompanionHandlerRegistry],
})
export class CompanionIngestModule {}
