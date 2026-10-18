import { Module, OnModuleInit } from '@nestjs/common';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { VALHEIM_MANIFEST } from './valheim.manifest';
import { ValheimAdapterRegistration } from './valheim-adapters';
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

/**
 * Valheim game plugin (ROK-1800) + Valheim Link token admin (ROK-1833).
 * Registers its manifest — no
 * `ensureInstalled`, so an uninstall survives a restart (as Pelican).
 */
@Module({
  controllers: [ValheimLinkTokensAdminController, ValheimLinkIngestController],
  providers: [
    ValheimAdapterRegistration,
    // ROK-1833 Valheim Link: token lifecycle + ingest guards (L3 uses them).
    ValheimLinkTokensRepository,
    ValheimLinkTokensService,
    ValheimLinkRemapListener,
    ValheimLinkRateLimiter,
    ValheimLinkBearerGuard,
    ValheimLinkRateLimitGuard,
    ValheimLinkSnapshotsRepository,
    ValheimLinkIngestService,
  ],
})
export class ValheimModule implements OnModuleInit {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(VALHEIM_MANIFEST);
  }
}
