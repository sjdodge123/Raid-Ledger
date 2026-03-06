import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type GuildMember,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteService } from '../services/pug-invite.service';
import { CharactersService } from '../../characters/characters.service';
import {
  DISCORD_BOT_EVENTS,
  PUG_SLOT_EVENTS,
  PUG_BUTTON_IDS,
  MEMBER_INVITE_BUTTON_IDS,
  MEMBER_INVITE_EVENTS,
  type MemberInviteCreatedPayload,
} from '../discord-bot.constants';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import { SignupsService } from '../../events/signups.service';
import {
  PugsService,
  type PugSlotCreatedPayload,
} from '../../events/pugs.service';
import type { PugInviteDeps } from './pug-invite.helpers';
import { handlePugButtonInteraction } from './pug-invite-pug.handlers';
import {
  handlePugCharacterSelectMenu,
  handlePugRoleSelectMenu,
} from './pug-invite-pug-select.handlers';
import { handleMemberInviteButton } from './pug-invite-member.handlers';
import {
  handleMemberCharacterSelectMenu,
  handleMemberRoleSelectMenu,
} from './pug-invite-member-select.handlers';
import { handleJoinEventButton } from './pug-invite-join.handlers';

/** Button ID prefix for the "Join Event" button on invite unfurls (ROK-263) */
const PUG_JOIN_PREFIX = 'pug_join';

/**
 * Listener that bridges NestJS events and Discord.js gateway events
 * for PUG invite flow (ROK-292).
 */
@Injectable()
export class PugInviteListener {
  private readonly logger = new Logger(PugInviteListener.name);
  private guildMemberAddRegistered = false;
  private boundGuildMemberAddHandler: ((member: GuildMember) => void) | null =
    null;
  private boundInteractionHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly pugInviteService: PugInviteService,
    private readonly charactersService: CharactersService,
    private readonly signupsService: SignupsService,
    private readonly pugsService: PugsService,
  ) {}

  private get deps(): PugInviteDeps {
    return {
      db: this.db,
      charactersService: this.charactersService,
      signupsService: this.signupsService,
      pugsService: this.pugsService,
      logger: this.logger,
    };
  }

  /** When bot connects, register interaction + guildMemberAdd listeners. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    this.registerGuildMemberAdd(client);
    this.registerInteractionHandler(client);
    this.logger.log('Registered PUG button interaction handler');
  }

  /** When bot disconnects, reset registration flags. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.guildMemberAddRegistered = false;
    this.boundGuildMemberAddHandler = null;
    this.boundInteractionHandler = null;
  }

  /** Handle PUG slot created event. */
  @OnEvent(PUG_SLOT_EVENTS.CREATED)
  async handlePugSlotCreated(payload: PugSlotCreatedPayload): Promise<void> {
    if (!payload.discordUsername) {
      this.logger.debug(
        'Skipping anonymous PUG slot for event %d (invite link flow)',
        payload.eventId,
      );
      return;
    }
    this.logger.debug(
      'Processing PUG slot created: %s for event %d',
      payload.discordUsername,
      payload.eventId,
    );
    await this.pugInviteService.processPugSlotCreated(
      payload.pugSlotId,
      payload.eventId,
      payload.discordUsername,
      payload.creatorUserId,
    );
  }

  /** Handle Discord OAuth login -- auto-claim matching PUG slots. */
  @OnEvent(AUTH_EVENTS.DISCORD_LOGIN)
  async handleDiscordLogin(payload: DiscordLoginPayload): Promise<void> {
    try {
      await this.pugInviteService.claimPugSlots(
        payload.discordId,
        payload.userId,
        payload.inviteCode,
      );
    } catch (error) {
      this.logger.error(
        'Failed to claim PUG slots for user %d (discord: %s):',
        payload.userId,
        payload.discordId,
        error,
      );
    }
  }

  /** Listen for member invite created event. */
  @OnEvent(MEMBER_INVITE_EVENTS.CREATED)
  async handleMemberInviteCreated(
    payload: MemberInviteCreatedPayload,
  ): Promise<void> {
    this.logger.debug(
      'Processing member invite: event %d -> Discord %s',
      payload.eventId,
      payload.targetDiscordId,
    );
    await this.pugInviteService.sendMemberInviteDm(
      payload.eventId,
      payload.targetDiscordId,
      payload.notificationId,
      payload.gameId ?? null,
    );
  }

  // --- Private registration helpers ---

  private registerGuildMemberAdd(
    client: ReturnType<DiscordBotClientService['getClient']> & object,
  ): void {
    if (this.guildMemberAddRegistered) return;
    this.boundGuildMemberAddHandler = (member: GuildMember) => {
      this.handleGuildMemberAdd(member).catch((err: unknown) => {
        this.logger.error(
          'Error handling guildMemberAdd for %s:',
          member.user.username,
          err,
        );
      });
    };
    client.on(Events.GuildMemberAdd, this.boundGuildMemberAddHandler);
    this.guildMemberAddRegistered = true;
    this.logger.log('Registered guildMemberAdd listener for PUG invite flow');
  }

  private registerInteractionHandler(
    client: ReturnType<DiscordBotClientService['getClient']> & object,
  ): void {
    if (this.boundInteractionHandler) {
      client.removeListener('interactionCreate', this.boundInteractionHandler);
    }
    this.boundInteractionHandler = (
      interaction: import('discord.js').Interaction,
    ) => {
      if (interaction.isButton()) void this.routeButton(interaction);
      else if (interaction.isStringSelectMenu())
        void this.routeSelectMenu(interaction);
    };
    client.on('interactionCreate', this.boundInteractionHandler);
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    this.logger.debug(
      'New guild member: %s (%s)',
      member.user.username,
      member.user.id,
    );
    await this.pugInviteService.handleNewGuildMember(
      member.user.id,
      member.user.username,
      member.user.avatar,
    );
  }

  private async routeButton(interaction: ButtonInteraction): Promise<void> {
    const action = interaction.customId.split(':')[0];
    if (action === PUG_JOIN_PREFIX) {
      const inviteCode = interaction.customId.split(':')[1];
      await handleJoinEventButton(this.deps, interaction, inviteCode);
    } else if (isPugAction(action)) {
      await handlePugButtonInteraction(this.deps, interaction);
    } else if (isMemberAction(action)) {
      await handleMemberInviteButton(this.deps, interaction);
    }
  }

  private async routeSelectMenu(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length < 2) return;
    const [action] = parts;
    if (action === PUG_BUTTON_IDS.CHARACTER_SELECT) {
      await handlePugCharacterSelectMenu(this.deps, interaction, parts[1]);
    } else if (action === PUG_BUTTON_IDS.ROLE_SELECT) {
      const charName = parts.length >= 3 ? parts.slice(2).join(':') : undefined;
      await handlePugRoleSelectMenu(this.deps, interaction, parts[1], charName);
    } else if (action === MEMBER_INVITE_BUTTON_IDS.CHARACTER_SELECT) {
      await handleMemberCharacterSelectMenu(this.deps, interaction, parts[1]);
    } else if (action === MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT) {
      const characterId = parts.length >= 3 ? parts[2] : undefined;
      await handleMemberRoleSelectMenu(
        this.deps,
        interaction,
        parts[1],
        characterId,
      );
    }
  }
}

function isPugAction(action: string): boolean {
  return action === PUG_BUTTON_IDS.ACCEPT || action === PUG_BUTTON_IDS.DECLINE;
}

function isMemberAction(action: string): boolean {
  return (
    action === MEMBER_INVITE_BUTTON_IDS.ACCEPT ||
    action === MEMBER_INVITE_BUTTON_IDS.DECLINE
  );
}
