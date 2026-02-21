import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { CharactersModule } from '../characters/characters.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordMemberController } from './discord-member.controller';
import { ChannelBindingsController } from './channel-bindings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { SetupWizardService } from './services/setup-wizard.service';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { PugInviteService } from './services/pug-invite.service';
import { DiscordEventListener } from './listeners/event.listener';
import { DiscordSyncListener } from './listeners/discord-sync.listener';
import { InteractionListener } from './listeners/interaction.listener';
import { SignupInteractionListener } from './listeners/signup-interaction.listener';
import { RoachOutInteractionListener } from './listeners/roach-out-interaction.listener';
import { PugInviteListener } from './listeners/pug-invite.listener';
import {
  EmbedSyncQueueService,
  EMBED_SYNC_QUEUE,
} from './queues/embed-sync.queue';
import { EmbedSyncProcessor } from './processors/embed-sync.processor';
import { RegisterCommandsService } from './commands/register-commands';
import { EventCreateCommand } from './commands/event-create.command';
import { EventsListCommand } from './commands/events-list.command';
import { RosterViewCommand } from './commands/roster-view.command';
import { BindCommand } from './commands/bind.command';
import { UnbindCommand } from './commands/unbind.command';
import { BindingsCommand } from './commands/bindings.command';
import { InviteCommand } from './commands/invite.command';
import { EventLinkListener } from './listeners/event-link.listener';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => UsersModule),
    forwardRef(() => EventsModule),
    forwardRef(() => AuthModule),
    CharactersModule,
    BullModule.registerQueue({ name: EMBED_SYNC_QUEUE }),
  ],
  controllers: [
    DiscordBotSettingsController,
    DiscordMemberController,
    ChannelBindingsController,
  ],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    ChannelResolverService,
    SetupWizardService,
    ChannelBindingsService,
    PugInviteService,
    DiscordEventListener,
    DiscordSyncListener,
    EmbedSyncQueueService,
    EmbedSyncProcessor,
    InteractionListener,
    SignupInteractionListener,
    RoachOutInteractionListener,
    PugInviteListener,
    EventLinkListener,
    RegisterCommandsService,
    EventCreateCommand,
    EventsListCommand,
    RosterViewCommand,
    BindCommand,
    UnbindCommand,
    BindingsCommand,
    InviteCommand,
  ],
  exports: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    DiscordEventListener,
    SetupWizardService,
    ChannelBindingsService,
    ChannelResolverService,
    PugInviteService,
  ],
})
export class DiscordBotModule {}
