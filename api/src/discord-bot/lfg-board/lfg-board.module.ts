/**
 * ROK-1471 D3 — wiring for the LFG forum board.
 *
 * A module of its own, mirroring `LfmEmbedModule`: the board's consumer
 * subscribes to `LFG_EVENTS`, and folding it into `DiscordBotModule` would
 * make the bot depend on `LfgModule` for a listener that reaches the database
 * directly.
 *
 * Registered in `app.module.ts` immediately after `LfmEmbedModule`, which
 * imports this module for `LfgBoardService`: ROK-1471 D9 makes the board a
 * forum SURFACE ADAPTER that `LfmEmbedService` dispatches to, not a second
 * subscriber of the same two events.
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
import { LfgBoardService } from './lfg-board.service';

@Module({
  imports: [DrizzleModule, SettingsModule, DiscordBotModule],
  providers: [LfgBoardChannelService, LfgBoardToggleListener, LfgBoardService],
  exports: [LfgBoardChannelService, LfgBoardService],
})
export class LfgBoardModule {}
