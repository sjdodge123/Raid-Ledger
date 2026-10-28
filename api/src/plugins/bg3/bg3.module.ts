import { Module, OnModuleInit } from '@nestjs/common';
import { CompanionHandlerRegistry } from '../../companion/ingest/companion-handler.registry';
import { CompanionIngestModule } from '../../companion/ingest/companion-ingest.module';
import { GuildsCoreModule } from '../../guilds/guilds-core.module';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from './bg3.constants';
import { BG3_MANIFEST } from './bg3.manifest';
import { Bg3CampaignsController } from './campaigns/bg3-campaigns.controller';
import { Bg3CampaignsRepository } from './campaigns/bg3-campaigns.repository';
import { Bg3CampaignsService } from './campaigns/bg3-campaigns.service';
import { Bg3ClaimsController } from './claims/bg3-claims.controller';
import { Bg3ClaimsRepository } from './claims/bg3-claims.repository';
import { Bg3ClaimsService } from './claims/bg3-claims.service';
import { Bg3SaveHandler } from './ingest/bg3-save.handler';
import { Bg3SavesWriteRepository } from './ingest/bg3-saves.write.repository';

/**
 * Baldur's Gate 3 plugin (ROK-1957). Registers its manifest (no
 * `ensureInstalled`, D-1) and its `bg3-save` companion handler. The
 * companion registry resolves a handler only while its owner plugin is
 * active, so an inactive `bg3` never ingests (404 `unknown_contract`).
 * Dependency direction: plugin → companion, never the reverse.
 */
@Module({
  imports: [CompanionIngestModule, GuildsCoreModule],
  controllers: [Bg3CampaignsController, Bg3ClaimsController],
  providers: [
    Bg3SaveHandler,
    Bg3SavesWriteRepository,
    Bg3CampaignsRepository,
    Bg3CampaignsService,
    Bg3ClaimsRepository,
    Bg3ClaimsService,
  ],
})
export class Bg3Module implements OnModuleInit {
  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly companionRegistry: CompanionHandlerRegistry,
    private readonly saveHandler: Bg3SaveHandler,
  ) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(BG3_MANIFEST);
    this.companionRegistry.register(BG3_PLUGIN_ID, this.saveHandler);
  }
}
