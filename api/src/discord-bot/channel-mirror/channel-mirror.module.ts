/**
 * ROK-1788 D2 — wiring for the guild page's read-only channel mirror.
 *
 * Its own module (thread-mirror.module.ts shape): imports `DiscordBotModule`
 * for the client, exports `ChannelMirrorService`, and nothing in the bot
 * imports it back. Plugin-agnostic: `WowCommonModule` imports it (L2), core
 * never imports WoW, so no cycle can form through it.
 */
import { Module } from '@nestjs/common';
import { DiscordBotModule } from '../discord-bot.module';
import { ChannelMirrorService } from './channel-mirror.service';

@Module({
  imports: [DiscordBotModule],
  providers: [ChannelMirrorService],
  exports: [ChannelMirrorService],
})
export class ChannelMirrorModule {}
