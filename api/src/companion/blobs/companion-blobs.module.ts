import { Module } from '@nestjs/common';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { CompanionDevicesModule } from '../devices/companion-devices.module';
import {
  CompanionIngestAuthGuard,
  CompanionSessionJwtGuard,
} from '../ingest/companion-ingest-auth.guard';
import { CompanionIngestModule } from '../ingest/companion-ingest.module';
import { CompanionIngestRateLimitGuard } from '../ingest/companion-ingest-rate-limit.guard';
import { CompanionBlobCleanupService } from './companion-blob-cleanup.service';
import { CompanionBlobController } from './companion-blob.controller';
import { CompanionBlobService } from './companion-blob.service';
import { CompanionBlobStore } from './companion-blob.store';
import { CompanionBlobsRepository } from './companion-blobs.repository';

/**
 * ROK-1956 §7: the companion blob upload route, its orphan cleanup, and the
 * exported `CompanionBlobStore` (plugins `open` blobs and `releaseRefs`).
 * The ingest guards are stateless and listed here rather than importing
 * `CompanionIngestModule`; the ingest transaction writes refs through the
 * pure `storedBlobsIn` / `upsertBlobRefsIn` helpers, so neither module
 * imports the other — except that this module imports
 * `CompanionIngestModule` for the shared `CompanionHandlerRegistry` (the
 * session-upload opt-in, R1); the ingest module never imports this one.
 */
@Module({
  imports: [CompanionDevicesModule, CronJobModule, CompanionIngestModule],
  controllers: [CompanionBlobController],
  providers: [
    CompanionIngestAuthGuard,
    CompanionSessionJwtGuard,
    CompanionIngestRateLimitGuard,
    CompanionBlobsRepository,
    CompanionBlobService,
    CompanionBlobStore,
    CompanionBlobCleanupService,
  ],
  exports: [CompanionBlobStore, CompanionBlobsRepository],
})
export class CompanionBlobsModule {}
