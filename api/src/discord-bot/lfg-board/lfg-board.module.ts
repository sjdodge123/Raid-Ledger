/**
 * ROK-1471 D3 — wiring for the LFG forum board.
 *
 * A module of its own, mirroring `LfmEmbedModule`: the board's consumer
 * subscribes to `LFG_EVENTS`, and folding it into `DiscordBotModule` would
 * make the bot depend on `LfgModule` for a listener that reaches the database
 * directly.
 *
 * NOT registered in `app.module.ts` yet — it is registered together with the
 * posting service, so the app never boots a resolver with nothing to resolve
 * for.
 *
 * `DiscordBotModule` is imported for the client + bindings services it
 * exports; the posting service added on top of this needs both.
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { LfgBoardChannelService } from './lfg-board-channel.service';
import { LfgBoardToggleListener } from './lfg-board-toggle.listener';

@Module({
  imports: [DrizzleModule, SettingsModule, DiscordBotModule],
  providers: [LfgBoardChannelService, LfgBoardToggleListener],
  exports: [LfgBoardChannelService],
})
export class LfgBoardModule {}
