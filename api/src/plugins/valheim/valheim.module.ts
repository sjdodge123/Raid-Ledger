import { Module, OnModuleInit } from '@nestjs/common';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { VALHEIM_MANIFEST } from './valheim.manifest';
import { ValheimAdapterRegistration } from './valheim-adapters';
import { ValheimLinkBlobController } from './link/blobs/valheim-link-blob.controller';
import { ValheimLinkBlobService } from './link/blobs/valheim-link-blob.service';
import { ValheimLinkBlobsRepository } from './link/blobs/valheim-link-blobs.repository';
import { ValheimLinkIngestController } from './link/ingest/valheim-link-ingest.controller';
import { ValheimLinkIngestService } from './link/ingest/valheim-link-ingest.service';
import { ValheimLinkSnapshotsRepository } from './link/ingest/valheim-link-snapshots.repository';
import { ValheimLinkBearerGuard } from './link/valheim-link-token.guard';
import { ValheimLinkRateLimitGuard } from './link/valheim-link-rate-limit.guard';
import { ValheimLinkRateLimiter } from './link/valheim-link-rate-limiter';
import { ValheimLinkRemapListener } from './link/valheim-link-remap.listener';
import { ValheimLinkTokensAdminController } from './link/valheim-link-tokens-admin.controller';
import { ValheimLinkTokensRepository } from './link/valheim-link-tokens.repository';
import { ValheimLinkTokensService } from './link/valheim-link-tokens.service';
import { ValheimLinkDemoSeedModule } from './link/valheim-link-demo-seed.module';
import { ValheimArmoryImportCron } from './armory/valheim-armory-import.cron';
import { ValheimArmoryImportService } from './armory/valheim-armory-import.service';
import { ValheimArmoryRepository } from './armory/valheim-armory.repository';
import {
  NOOP_PROFILE_UPSERTED_HOOK,
  VALHEIM_PROFILE_UPSERTED_HOOK,
} from './armory/valheim-armory-profile.hook';

/**
 * Valheim game plugin (ROK-1800) + Valheim Link token admin (ROK-1833) +
 * the armory importer (ROK-1835).
 * Registers its manifest — no
 * `ensureInstalled`, so an uninstall survives a restart (as Pelican).
 */
@Module({
  // ROK-1833 DEMO_MODE fixture route (admin + DemoModeGuard).
  imports: [ValheimLinkDemoSeedModule],
  controllers: [
    ValheimLinkTokensAdminController,
    ValheimLinkIngestController,
    ValheimLinkBlobController,
  ],
  providers: [
    ValheimAdapterRegistration,
    // ROK-1833 Valheim Link: token lifecycle + ingest guards.
    ValheimLinkTokensRepository,
    ValheimLinkTokensService,
    ValheimLinkRemapListener,
    ValheimLinkRateLimiter,
    ValheimLinkBearerGuard,
    ValheimLinkRateLimitGuard,
    ValheimLinkSnapshotsRepository,
    ValheimLinkIngestService,
    ValheimLinkBlobsRepository,
    ValheimLinkBlobService,
    // ROK-1835 armory importer (30 s drain). L3 swaps the hook provider.
    ValheimArmoryRepository,
    ValheimArmoryImportService,
    ValheimArmoryImportCron,
    {
      provide: VALHEIM_PROFILE_UPSERTED_HOOK,
      useValue: NOOP_PROFILE_UPSERTED_HOOK,
    },
  ],
})
export class ValheimModule implements OnModuleInit {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(VALHEIM_MANIFEST);
  }
}
