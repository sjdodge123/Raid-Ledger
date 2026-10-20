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
import { ValheimArmoryBlobController } from './armory/read/valheim-armory-blob.controller';
import { ValheimArmoryMapBytesController } from './armory/read/valheim-armory-map-bytes.controller';
import { ValheimArmoryMapBytesService } from './armory/read/valheim-armory-map-bytes.service';
import { ValheimLinkDemoSeedModule } from './link/valheim-link-demo-seed.module';
import { ValheimArmoryImportCron } from './armory/valheim-armory-import.cron';
import { ValheimArmoryImportService } from './armory/valheim-armory-import.service';
import { ValheimArmoryRepository } from './armory/valheim-armory.repository';
import { VALHEIM_PROFILE_UPSERTED_HOOK } from './armory/valheim-armory-profile.hook';
import { ValheimArmoryClaimsController } from './armory/identity/valheim-armory-claims.controller';
import { ValheimArmoryClaimsService } from './armory/identity/valheim-armory-claims.service';
import { ValheimIdentityRepository } from './armory/identity/valheim-identity.repository';
import { ValheimIdentityService } from './armory/identity/valheim-identity.service';
import { ValheimSteamLinkListener } from './armory/identity/valheim-steam-link.listener';
import { ValheimArmoryReadController } from './armory/read/valheim-armory-read.controller';
import { ValheimArmoryReadRepository } from './armory/read/valheim-armory-read.repository';
import { ValheimArmoryReadService } from './armory/read/valheim-armory-read.service';
import { ValheimMaterialsController } from './armory/read/valheim-materials.controller';
import { ValheimMaterialsRepository } from './armory/read/valheim-materials.repository';
import { ValheimMaterialsService } from './armory/read/valheim-materials.service';

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
    ValheimArmoryClaimsController,
    ValheimArmoryReadController,
    ValheimMaterialsController,
    ValheimArmoryBlobController,
    ValheimArmoryMapBytesController,
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
    // ROK-1835 armory importer (30 s drain) + Steam identity / claims.
    ValheimArmoryRepository,
    ValheimArmoryImportService,
    ValheimArmoryImportCron,
    ValheimIdentityRepository,
    ValheimIdentityService,
    ValheimSteamLinkListener,
    ValheimArmoryClaimsService,
    // ROK-1835 L4 member/admin reads.
    ValheimArmoryReadRepository,
    ValheimArmoryReadService,
    ValheimMaterialsRepository,
    ValheimMaterialsService,
    ValheimArmoryMapBytesService,
    {
      provide: VALHEIM_PROFILE_UPSERTED_HOOK,
      useExisting: ValheimIdentityService,
    },
  ],
})
export class ValheimModule implements OnModuleInit {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(VALHEIM_MANIFEST);
  }
}
