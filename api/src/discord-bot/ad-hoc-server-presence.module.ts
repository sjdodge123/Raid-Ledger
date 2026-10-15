import { Global, Module } from '@nestjs/common';
import { SERVER_PRESENCE_SINK } from '../plugins/pelican/presence/server-presence.sink';
import { DiscordBotModule } from './discord-bot.module';
import { AdHocServerPresenceService } from './services/ad-hoc-server-presence.service';

/**
 * ROK-1800 — exposes Quick Play's server-presence sink to the Pelican plugin.
 *
 * Global so `PelicanModule` can `@Inject(SERVER_PRESENCE_SINK)` without
 * importing the Discord bot (the sink file's contract: Pelican never imports
 * it). The provider itself lives in `DiscordBotModule`, which owns every
 * ad-hoc dependency; this module only aliases it under the token.
 */
@Global()
@Module({
  imports: [DiscordBotModule],
  providers: [
    {
      provide: SERVER_PRESENCE_SINK,
      useExisting: AdHocServerPresenceService,
    },
  ],
  exports: [SERVER_PRESENCE_SINK],
})
export class AdHocServerPresenceModule {}
