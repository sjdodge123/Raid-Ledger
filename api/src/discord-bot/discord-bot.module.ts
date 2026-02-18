import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { DiscordEventListener } from './listeners/event.listener';

@Module({
  imports: [SettingsModule],
  controllers: [DiscordBotSettingsController],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    ChannelResolverService,
    DiscordEventListener,
  ],
  exports: [DiscordBotService, DiscordEmbedFactory, DiscordEventListener],
})
export class DiscordBotModule {}
