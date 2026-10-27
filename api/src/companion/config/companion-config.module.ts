import { Module } from '@nestjs/common';
import { CompanionDevicesModule } from '../devices/companion-devices.module';
import {
  CompanionIngestAuthGuard,
  CompanionSessionJwtGuard,
} from '../ingest/companion-ingest-auth.guard';
import { CompanionIngestModule } from '../ingest/companion-ingest.module';
import { CompanionConfigAuthGuard } from './companion-config-auth.guard';
import { CompanionConfigController } from './companion-config.controller';
import { CompanionConfigService } from './companion-config.service';

/**
 * ROK-1956 §8: `GET /companion/v1/config`. Imports `CompanionIngestModule`
 * for the exported `CompanionHandlerRegistry` (the same singleton the
 * messages route resolves against). The stateless D-17 guards are listed
 * here, as `CompanionBlobsModule` does.
 *
 * TODO(ROK-1969): once the hub ownership scan lands on main, add
 * `companionHandlers()` to `hub-registration-scan.ts` (`SCANNED_KINDS` +=
 * `'ingest-source'`) so every `CompanionHandlerRegistry.register(owner, …)`
 * call is checked against the owner's declared kinds, plus a mutation probe.
 */
@Module({
  imports: [CompanionDevicesModule, CompanionIngestModule],
  controllers: [CompanionConfigController],
  providers: [
    CompanionIngestAuthGuard,
    CompanionSessionJwtGuard,
    CompanionConfigAuthGuard,
    CompanionConfigService,
  ],
})
export class CompanionConfigModule {}
