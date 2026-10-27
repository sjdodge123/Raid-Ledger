import { Module } from '@nestjs/common';
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
import {
  HubMediaIngestPool,
  readIngestPoolLimits,
} from './hub-media-ingest.pool';
import { HubMediaReadService } from './hub-media-read.service';
import { HubMediaService } from './hub-media.service';

/**
 * ROK-1942: the shared hub media store. Exports `HubMediaService` (the
 * `ingest` / `removeByProvenance` seam sources such as ROK-1941 call) and
 * `HubMediaDecoratorRegistry` (a source's "Show on map" link, D9) and
 * `HubMediaIngestPool` (ROK-1965 D9: the ONE process-wide encode gate that
 * Discord ingest, backfill and member uploads share).
 * GuildsCoreModule for `GuildAccessService` (D7); SettingsModule for the
 * DEMO_MODE seed's `DemoModeGuard`.
 */
@Module({
  imports: [GuildsCoreModule, SettingsModule],
  controllers: [
    HubMediaController,
    HubMediaBytesController,
    HubMediaDemoSeedController,
  ],
  providers: [
    HubMediaService,
    HubMediaReadService,
    HubMediaDecoratorRegistry,
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
    HubMediaPostClassifierRegistry,
    HubMediaIngestPool,
  ],
})
export class HubMediaModule {}
