/**
 * ROK-1454 D8 — wiring for the LFM embed consumer.
 *
 * A module of its own rather than a provider inside `DiscordBotModule`: the
 * consumer subscribes to `LFG_EVENTS`, and folding it into the bot module
 * would make the bot depend on `LfgModule` for a listener that already reaches
 * the database directly. Registered in `app.module.ts` after `LfgModule`.
 *
 * `DiscordBotModule` is imported for `DiscordBotClientService` +
 * `ChannelBindingsService`, both of which it exports. `LfgBoardModule` supplies
 * the ROK-1471 forum surface adapter this service dispatches to — the board
 * subscribes to nothing, so there is exactly one consumer per event (D9).
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { LfgBoardModule } from '../lfg-board/lfg-board.module';
import { LfmEmbedService } from './lfm-embed.service';

@Module({
  imports: [DrizzleModule, SettingsModule, DiscordBotModule, LfgBoardModule],
  providers: [LfmEmbedService],
  exports: [LfmEmbedService],
})
export class LfmEmbedModule {}
