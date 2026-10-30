import { Module } from '@nestjs/common';
import { HubMediaModule } from '../../hub-media/hub-media.module';
import { GuildsCoreModule } from '../guilds-core.module';
import { HubCrestController } from './hub-crest.controller';
import { HubCrestService } from './hub-crest.service';

/**
 * ROK-1814 — the hub crest routes. Their own module (not `GuildsCoreModule`)
 * because the gallery pick needs `HubMediaSourceGateRegistry`, and
 * `HubMediaModule` already imports `GuildsCoreModule`.
 */
@Module({
  imports: [GuildsCoreModule, HubMediaModule],
  controllers: [HubCrestController],
  providers: [HubCrestService],
})
export class HubCrestModule {}
