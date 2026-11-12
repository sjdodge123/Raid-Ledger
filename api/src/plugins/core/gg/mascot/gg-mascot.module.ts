import { Module, forwardRef } from '@nestjs/common';
import { DiscordBotModule } from '../../../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../../../settings/settings.module';
import { GgMascotController } from './gg-mascot.controller';
import { GgMascotDiscordSource } from './gg-mascot-discord.source';
import {
  GgMascotExpressionSource,
  GgMascotOptionsService,
} from './gg-mascot-options.service';
import { GgMascotService } from './gg-mascot.service';

/** ROK-2187 — the community GG mascot (Core): picker API + copy service. */
@Module({
  imports: [SettingsModule, forwardRef(() => DiscordBotModule)],
  controllers: [GgMascotController],
  providers: [
    { provide: GgMascotExpressionSource, useClass: GgMascotDiscordSource },
    GgMascotOptionsService,
    GgMascotService,
  ],
  exports: [GgMascotService],
})
export class GgMascotModule {}
