import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';

@Module({
  imports: [SettingsModule],
  controllers: [DiscordBotSettingsController],
  providers: [DiscordBotService, DiscordBotClientService],
  exports: [DiscordBotService],
})
export class DiscordBotModule {}
