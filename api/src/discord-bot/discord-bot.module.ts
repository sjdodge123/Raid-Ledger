import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { DiscordEventListener } from './listeners/event.listener';
import { SignupInteractionListener } from './listeners/signup-interaction.listener';
import { EventsModule } from '../events/events.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => EventsModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [DiscordBotSettingsController],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    ChannelResolverService,
    DiscordEventListener,
    SignupInteractionListener,
  ],
  exports: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    DiscordEventListener,
  ],
})
export class DiscordBotModule {}
