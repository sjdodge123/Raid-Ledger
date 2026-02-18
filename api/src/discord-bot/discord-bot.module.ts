import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { DiscordEventListener } from './listeners/event.listener';
import { InteractionListener } from './listeners/interaction.listener';
import { RegisterCommandsService } from './commands/register-commands';
import { EventCreateCommand } from './commands/event-create.command';
import { EventsListCommand } from './commands/events-list.command';
import { RosterViewCommand } from './commands/roster-view.command';

@Module({
  imports: [SettingsModule, AuthModule, EventsModule, UsersModule],
  controllers: [DiscordBotSettingsController],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    ChannelResolverService,
    DiscordEventListener,
    InteractionListener,
    RegisterCommandsService,
    EventCreateCommand,
    EventsListCommand,
    RosterViewCommand,
  ],
  exports: [DiscordBotService, DiscordEmbedFactory, DiscordEventListener],
})
export class DiscordBotModule {}
