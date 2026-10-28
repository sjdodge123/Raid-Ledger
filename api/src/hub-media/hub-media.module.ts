import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { GuildsCoreModule } from '../guilds/guilds-core.module';
import { SettingsModule } from '../settings/settings.module';
import {
  HUB_MEDIA_DOWNLOADER,
  fetchHubMediaDownloader,
} from './hub-media-download';
import { HubMediaBytesController } from './hub-media-bytes.controller';
import { HubMediaDemoSeedController } from './hub-media-demo-seed.controller';
import { HubMediaController } from './hub-media.controller';
import { HubMediaPostClassifierRegistry } from './hub-media-classifier.registry';
import { HubMediaDecoratorRegistry } from './hub-media.decorators';
import { HubMediaSubjectRegistry } from './hub-media.subjects';
import {
  HubMediaIngestPool,
  readIngestPoolLimits,
} from './hub-media-ingest.pool';
import {
  hubIngestSources,
  registerHubIngestSource,
} from './hub-media-ingest-sources';
import { HubMediaReadService } from './hub-media-read.service';
import { HubMediaUploadController } from './hub-media-upload.controller';
import { HubMediaUploadGuard } from './hub-media-upload.guard';
import { HubMediaUploadService } from './hub-media-upload.service';
import { HubMediaService } from './hub-media.service';

/**
 * ROK-1942: the shared hub media store. Exports `HubMediaService` (the
 * `ingest` / `removeByProvenance` seam sources such as ROK-1941 call) and
 * `HubMediaDecoratorRegistry` (a source's "Show on map" link, D9) and
 * `HubMediaSubjectRegistry` (ROK-2027: a plugin's `?subject=` resolver) and
 * `HubMediaIngestPool` (ROK-1965 D9: the ONE process-wide encode gate that
 * Discord ingest, backfill and member uploads share).
 * GuildsCoreModule for `GuildAccessService` (D7); SettingsModule for the
 * DEMO_MODE seed's `DemoModeGuard`.
 */
@Module({
  imports: [GuildsCoreModule, SettingsModule],
  controllers: [
    HubMediaController,
    HubMediaUploadController,
    HubMediaBytesController,
    HubMediaDemoSeedController,
  ],
  providers: [
    HubMediaService,
    HubMediaReadService,
    HubMediaUploadService,
    HubMediaUploadGuard,
    HubMediaDecoratorRegistry,
    HubMediaSubjectRegistry,
    HubMediaPostClassifierRegistry,
    { provide: HUB_MEDIA_DOWNLOADER, useValue: fetchHubMediaDownloader },
    {
      provide: HubMediaIngestPool,
      useFactory: () => new HubMediaIngestPool(readIngestPoolLimits()),
    },
  ],
  exports: [
    HubMediaService,
    HubMediaDecoratorRegistry,
    HubMediaSubjectRegistry,
    HubMediaPostClassifierRegistry,
    HubMediaIngestPool,
  ],
})
export class HubMediaModule implements OnModuleInit {
  private readonly logger = new Logger(HubMediaModule.name);

  /** ROK-1965 D17: member uploads are a Core ingest source. */
  onModuleInit(): void {
    registerHubIngestSource(CORE_PLUGIN_ID, 'hub-media.upload');
    this.logger.log(`hub ingest sources: ${hubIngestSources().join(', ')}`);
  }
}
