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
import { LfgBoardRetireService } from './lfg-board-retire.service';
import { LfgBoardToggleListener } from './lfg-board-toggle.listener';
import { LfgBoardService } from './lfg-board.service';
import { LfgBoardThreadMembersService } from './lfg-board-thread-members.service';
import { LfgGameChainService } from './lfg-game-chain.service';
import { LfgComposerPinService } from '../lfg-composer/lfg-composer-pin.service';

@Module({
  imports: [DrizzleModule, SettingsModule, DiscordBotModule],
  providers: [
    LfgBoardChannelService,
    LfgBoardToggleListener,
    LfgBoardService,
    LfgBoardRetireService,
    LfgGameChainService,
    // ROK-1541 — adds group members to the post's thread on join / post.
    LfgBoardThreadMembersService,
    // ROK-1612 AC1 — keeps the LFG composer card pinned.
    LfgComposerPinService,
  ],
  exports: [
    LfgBoardChannelService,
    LfgBoardService,
    LfgBoardRetireService,
    // ROK-1523 — `LfmEmbedService` queues on the same instance. Exporting it
    // is what makes "the same chain" true across the two modules.
    LfgGameChainService,
  ],
})
export class LfgBoardModule {}
