import { Global, Module } from '@nestjs/common';
import { SERVER_DEATH_SINK } from '../../pelican/presence/server-death.sink';
import { SettingsModule } from '../../../settings/settings.module';
import { ValheimDeathSink } from './valheim-deaths.sink';
import { ValheimDeathsRepository } from './valheim-deaths.repository';

/**
 * ROK-1930 — exposes the Valheim death sink to the Pelican presence
 * supervisor. Global so `PelicanModule` can `@Inject(SERVER_DEATH_SINK)`
 * without importing Valheim (as `AdHocServerPresenceModule` does for
 * `SERVER_PRESENCE_SINK`).
 */
@Global()
@Module({
  imports: [SettingsModule],
  providers: [
    ValheimDeathsRepository,
    ValheimDeathSink,
    { provide: SERVER_DEATH_SINK, useExisting: ValheimDeathSink },
  ],
  exports: [SERVER_DEATH_SINK, ValheimDeathsRepository],
})
export class ValheimDeathsModule {}
