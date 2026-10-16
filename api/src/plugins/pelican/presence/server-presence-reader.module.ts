import { Global, Module } from '@nestjs/common';
import { PelicanModule } from '../pelican.module';
import { PelicanPresenceSupervisor } from './pelican-presence.supervisor';
import { SERVER_PRESENCE_READER } from './server-presence.reader';

/**
 * ROK-1801 — exposes the presence supervisor's roster to the Discord bot.
 *
 * Global so discord-bot services can `@Optional() @Inject(SERVER_PRESENCE_READER)`
 * without importing `PelicanModule` — the mirror image of
 * `discord-bot/ad-hoc-server-presence.module.ts` (the sink, other direction).
 * The supervisor lives in `PelicanModule`; this module only aliases it.
 */
@Global()
@Module({
  imports: [PelicanModule],
  providers: [
    {
      provide: SERVER_PRESENCE_READER,
      useExisting: PelicanPresenceSupervisor,
    },
  ],
  exports: [SERVER_PRESENCE_READER],
})
export class ServerPresenceReaderModule {}
