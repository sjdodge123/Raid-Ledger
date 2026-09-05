/**
 * ROK-1454 D8 — wiring for the LFM embed consumer.
 *
 * A module of its own rather than a provider inside `DiscordBotModule`: the
 * consumer subscribes to `LFG_EVENTS`, and folding it into the bot module
 * would make the bot depend on `LfgModule` for a listener that already reaches
 * the database directly. Registered in `app.module.ts` after `LfgModule`.
 *
 * `DiscordBotModule` is imported for `DiscordBotClientService` +
 * `ChannelBindingsService`, both of which it exports.
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { LfmEmbedService } from './lfm-embed.service';

@Module({
  imports: [DrizzleModule, SettingsModule, DiscordBotModule],
  providers: [LfmEmbedService],
  exports: [LfmEmbedService],
})
export class LfmEmbedModule {}
