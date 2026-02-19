import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { CharactersModule } from '../characters/characters.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { ChannelBindingsController } from './channel-bindings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { SetupWizardService } from './services/setup-wizard.service';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { DiscordEventListener } from './listeners/event.listener';
import { InteractionListener } from './listeners/interaction.listener';
import { SignupInteractionListener } from './listeners/signup-interaction.listener';
import { RegisterCommandsService } from './commands/register-commands';
import { EventCreateCommand } from './commands/event-create.command';
import { EventsListCommand } from './commands/events-list.command';
import { RosterViewCommand } from './commands/roster-view.command';
import { BindCommand } from './commands/bind.command';
import { UnbindCommand } from './commands/unbind.command';
import { BindingsCommand } from './commands/bindings.command';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => UsersModule),
    forwardRef(() => EventsModule),
    forwardRef(() => AuthModule),
    CharactersModule,
  ],
  controllers: [DiscordBotSettingsController, ChannelBindingsController],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    ChannelResolverService,
    SetupWizardService,
    ChannelBindingsService,
    DiscordEventListener,
    InteractionListener,
    SignupInteractionListener,
    RegisterCommandsService,
    EventCreateCommand,
    EventsListCommand,
    RosterViewCommand,
    BindCommand,
    UnbindCommand,
    BindingsCommand,
  ],
  exports: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    DiscordEventListener,
    SetupWizardService,
    ChannelBindingsService,
  ],
})
export class DiscordBotModule {}
