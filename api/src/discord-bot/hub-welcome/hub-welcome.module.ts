/**
 * ROK-1933 Part 4 — wiring for the hub welcome embed. Imports the bot module
 * for the client; `GuildsCoreModule` imports this for the re-post route.
 * Nothing in the bot imports it back, so no cycle forms through it.
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../../settings/settings.module';
import { DiscordBotModule } from '../discord-bot.module';
import { HubWelcomeListener } from './hub-welcome.listener';
import { HubWelcomeService } from './hub-welcome.service';

@Module({
  imports: [DiscordBotModule, SettingsModule],
  providers: [HubWelcomeService, HubWelcomeListener],
  exports: [HubWelcomeService],
})
export class HubWelcomeModule {}
