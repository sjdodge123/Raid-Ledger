import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
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
import { ValheimMapMaskCache } from './armory/read/valheim-map-mask.cache';
import { ValheimMapMaskRepository } from './armory/read/valheim-map-mask.repository';
import { ValheimLinkDemoSeedModule } from './link/valheim-link-demo-seed.module';
import { ValheimArmoryImportCron } from './armory/valheim-armory-import.cron';
import { ValheimArmoryImportService } from './armory/valheim-armory-import.service';
import { ValheimArmoryRepository } from './armory/valheim-armory.repository';
import { ValheimSkillDaysRepository } from './armory/valheim-skill-days.repository';
import { SettingsModule } from '../../settings/settings.module';
import { VALHEIM_PROFILE_UPSERTED_HOOK } from './armory/valheim-armory-profile.hook';
import { ValheimArmoryClaimsController } from './armory/identity/valheim-armory-claims.controller';
import { ValheimArmoryClaimsService } from './armory/identity/valheim-armory-claims.service';
import { ValheimClaimSuggestService } from './armory/identity/valheim-claim-suggest.service';
import { ValheimClaimSuggestCron } from './armory/identity/valheim-claim-suggest.cron';
import { ValheimClaimSuggestDemoController } from './armory/identity/valheim-claim-suggest-demo.controller';
import { NotificationModule } from '../../notifications/notification.module';
import { DiscordBotModule } from '../../discord-bot/discord-bot.module';
import { ValheimClaimSuggestListener } from '../../discord-bot/listeners/valheim-claim-suggest.listener';
import { ValheimIdentityRepository } from './armory/identity/valheim-identity.repository';
import { ValheimIdentityService } from './armory/identity/valheim-identity.service';
import { ValheimSteamLinkListener } from './armory/identity/valheim-steam-link.listener';
import { ValheimArmoryReadController } from './armory/read/valheim-armory-read.controller';
import { ValheimArmoryReadRepository } from './armory/read/valheim-armory-read.repository';
import { ValheimArmoryReadService } from './armory/read/valheim-armory-read.service';
import { ValheimMaterialsController } from './armory/read/valheim-materials.controller';
import { ValheimMaterialsRepository } from './armory/read/valheim-materials.repository';
import { ValheimMaterialsService } from './armory/read/valheim-materials.service';
import { ValheimDeathsController } from './armory/read/valheim-deaths.controller';
import { ValheimDeathsService } from './armory/read/valheim-deaths.service';
import { ValheimServerPortalsController } from './armory/read/valheim-server-portals.controller';
import { ValheimServerPortalsService } from './armory/read/valheim-server-portals.service';
import { ValheimDeathPinsRepository } from './armory/read/valheim-deaths-pins.repository';
import { ValheimServerPinsController } from './armory/read/valheim-server-pins.controller';
import { ValheimServerPinsService } from './armory/read/valheim-server-pins.service';
import { ValheimServerPinsRepository } from './armory/read/valheim-server-pins.repository';
import { GuildsCoreModule } from '../../guilds/guilds-core.module';
import { ValheimRecipesController } from './armory/read/valheim-recipes.controller';
import { ValheimRecipesReadRepository } from './armory/read/valheim-recipes.read.repository';
import { ValheimRecipesService } from './armory/read/valheim-recipes.service';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { ValheimDeathsModule } from './armory/valheim-deaths.module';

/**
 * Valheim game plugin (ROK-1800) + Valheim Link token admin (ROK-1833) +
 * the armory importer (ROK-1835).
 * Registers its manifest — no
 * `ensureInstalled`, so an uninstall survives a restart (as Pelican).
 */
@Module({
  // ROK-1833 DEMO_MODE fixture route (admin + DemoModeGuard).
  // ROK-1933 L2: NotificationModule for the claim-suggestion DM; L3:
  // DiscordBotModule for the bot client the DM-button listener binds to;
  // SettingsModule for the claim-suggest service's client URL (and ROK-1882's
  // community default tz for skill play days); CronJobModule
  // for the claim-suggest cron's run tracking.
  imports: [
    ValheimLinkDemoSeedModule,
    NotificationModule,
    SettingsModule,
    CronJobModule,
    // ROK-1930: the death sink the Pelican presence supervisor injects.
    ValheimDeathsModule,
    // ROK-1930 L2: GuildAccessService for the Deaths widget's D6 check.
    GuildsCoreModule,
    forwardRef(() => DiscordBotModule),
  ],
  controllers: [
    ValheimLinkTokensAdminController,
    ValheimLinkIngestController,
    ValheimLinkBlobController,
    ValheimArmoryClaimsController,
    ValheimArmoryReadController,
    ValheimMaterialsController,
    ValheimDeathsController,
    ValheimServerPinsController,
    ValheimServerPortalsController,
    ValheimRecipesController,
    ValheimArmoryBlobController,
    ValheimArmoryMapBytesController,
    // ROK-1933 L6a DEMO_MODE scan trigger (admin + DemoModeGuard).
    ValheimClaimSuggestDemoController,
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
    ValheimSkillDaysRepository,
    ValheimArmoryImportService,
    ValheimArmoryImportCron,
    ValheimIdentityRepository,
    ValheimIdentityService,
    ValheimSteamLinkListener,
    ValheimArmoryClaimsService,
    // ROK-1933 L2 suggested-claim DM scan.
    ValheimClaimSuggestService,
    ValheimClaimSuggestCron,
    // ROK-1933 L3 the DM's Yes / Not me buttons.
    ValheimClaimSuggestListener,
    // ROK-1835 L4 member/admin reads.
    ValheimArmoryReadRepository,
    ValheimArmoryReadService,
    ValheimMaterialsRepository,
    ValheimMaterialsService,
    ValheimDeathsService,
    ValheimServerPortalsService,
    ValheimDeathPinsRepository,
    // ROK-1943 Map tab cross-player pin layer.
    ValheimServerPinsService,
    ValheimServerPinsRepository,
    ValheimRecipesReadRepository,
    ValheimRecipesService,
    ValheimArmoryMapBytesService,
    // ROK-1949 per-viewer base-map mask.
    ValheimMapMaskRepository,
    ValheimMapMaskCache,
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
