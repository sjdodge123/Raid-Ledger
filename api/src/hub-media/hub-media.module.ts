import { Module } from '@nestjs/common';
import {
  HUB_MEDIA_DOWNLOADER,
  fetchHubMediaDownloader,
} from './hub-media-download';
import { HubMediaService } from './hub-media.service';

/**
 * ROK-1942: the shared hub media store. Exports `HubMediaService` (the
 * `ingest` / `removeByProvenance` seam sources such as ROK-1941 call).
 * The read/moderation controllers land with lane L2.
 */
@Module({
  providers: [
    HubMediaService,
    { provide: HUB_MEDIA_DOWNLOADER, useValue: fetchHubMediaDownloader },
  ],
  exports: [HubMediaService],
})
export class HubMediaModule {}
