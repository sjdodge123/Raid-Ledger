import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, type GuildMember } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteService } from '../services/pug-invite.service';
import { DISCORD_BOT_EVENTS, PUG_SLOT_EVENTS } from '../discord-bot.constants';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import type { PugSlotCreatedPayload } from '../../events/pugs.service';

/**
 * Listener that bridges NestJS events and Discord.js gateway events
 * for PUG invite flow (ROK-292).
 *
 * 1. Listens for PugSlotCreated → triggers server membership check + invite
 * 2. Registers guildMemberAdd on bot connect → matches pending PUG slots
 * 3. Listens for Discord OAuth login → auto-claims matching PUG slots
 */
@Injectable()
export class PugInviteListener {
  private readonly logger = new Logger(PugInviteListener.name);
  private guildMemberAddRegistered = false;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly pugInviteService: PugInviteService,
  ) {}

  /**
   * When bot connects, register the guildMemberAdd listener on the Discord.js client.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client || this.guildMemberAddRegistered) return;

    client.on(Events.GuildMemberAdd, (member: GuildMember) => {
      this.handleGuildMemberAdd(member).catch((err: unknown) => {
        this.logger.error(
          'Error handling guildMemberAdd for %s:',
          member.user.username,
          err,
        );
      });
    });

    this.guildMemberAddRegistered = true;
    this.logger.log('Registered guildMemberAdd listener for PUG invite flow');
  }

  /**
   * When bot disconnects, reset the registration flag.
   * The old client is destroyed, so we need to re-register on next connect.
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.guildMemberAddRegistered = false;
  }

  /**
   * Handle PUG slot created event.
   * Runs async — does not block the API response.
   */
  @OnEvent(PUG_SLOT_EVENTS.CREATED)
  async handlePugSlotCreated(payload: PugSlotCreatedPayload): Promise<void> {
    this.logger.debug(
      'Processing PUG slot created: %s for event %d',
      payload.discordUsername,
      payload.eventId,
    );

    await this.pugInviteService.processPugSlotCreated(
      payload.pugSlotId,
      payload.eventId,
      payload.discordUsername,
    );
  }

  /**
   * Handle Discord OAuth login — auto-claim matching PUG slots.
   */
  @OnEvent(AUTH_EVENTS.DISCORD_LOGIN)
  async handleDiscordLogin(payload: DiscordLoginPayload): Promise<void> {
    try {
      await this.pugInviteService.claimPugSlots(
        payload.discordId,
        payload.userId,
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

  /**
   * Handle new guild member joining.
   * Checks for pending PUG slots matching the new member's username.
   */
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
}
