import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  EmbedBuilder,
  type GuildMember,
  type ButtonInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteService } from '../services/pug-invite.service';
import {
  DISCORD_BOT_EVENTS,
  PUG_SLOT_EVENTS,
  PUG_BUTTON_IDS,
  EMBED_COLORS,
} from '../discord-bot.constants';
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
  private boundInteractionHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly pugInviteService: PugInviteService,
  ) {}

  /**
   * When bot connects, register the guildMemberAdd listener on the Discord.js client.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    // Register guildMemberAdd for new member matching
    if (!this.guildMemberAddRegistered) {
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
      this.logger.log(
        'Registered guildMemberAdd listener for PUG invite flow',
      );
    }

    // ROK-292: Register interaction handler for PUG accept/decline buttons
    if (this.boundInteractionHandler) {
      client.removeListener('interactionCreate', this.boundInteractionHandler);
    }

    this.boundInteractionHandler = (
      interaction: import('discord.js').Interaction,
    ) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundInteractionHandler);
    this.logger.log('Registered PUG button interaction handler');
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

  /**
   * ROK-292: Handle PUG accept/decline button interactions on DMs.
   */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const customId = interaction.customId;
    const parts = customId.split(':');
    if (parts.length !== 2) return;

    const [action, pugSlotId] = parts;

    // Only handle PUG buttons
    if (
      action !== PUG_BUTTON_IDS.ACCEPT &&
      action !== PUG_BUTTON_IDS.DECLINE
    ) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Look up the PUG slot
      const [slot] = await this.db
        .select()
        .from(schema.pugSlots)
        .where(eq(schema.pugSlots.id, pugSlotId))
        .limit(1);

      if (!slot) {
        await interaction.editReply({
          content: 'This invite is no longer valid.',
        });
        return;
      }

      // Verify the interaction user matches the invited Discord user
      if (slot.discordUserId && slot.discordUserId !== interaction.user.id) {
        await interaction.editReply({
          content: 'This invite is not for you.',
        });
        return;
      }

      if (action === PUG_BUTTON_IDS.ACCEPT) {
        await this.handlePugAccept(interaction, slot);
      } else {
        await this.handlePugDecline(interaction, slot);
      }
    } catch (error) {
      this.logger.error(
        'Error handling PUG button interaction for slot %s:',
        pugSlotId,
        error,
      );
      try {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Handle PUG accept button: update status to 'accepted', confirm in DM.
   */
  private async handlePugAccept(
    interaction: ButtonInteraction,
    slot: typeof schema.pugSlots.$inferSelect,
  ): Promise<void> {
    if (slot.status === 'accepted' || slot.status === 'claimed') {
      await interaction.editReply({
        content: "You've already accepted this invite!",
      });
      return;
    }

    await this.db
      .update(schema.pugSlots)
      .set({
        status: 'accepted',
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, slot.id));

    // Edit the original DM to show accepted state (remove buttons)
    const acceptedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
      .setTitle('Invite Accepted!')
      .setDescription(
        `You accepted the invite for **${slot.role}** slot. See you at the raid!`,
      )
      .setTimestamp();

    try {
      await interaction.message.edit({
        embeds: [acceptedEmbed],
        components: [],
      });
    } catch {
      // DM edit may fail if message was deleted
    }

    await interaction.editReply({ content: 'Accepted!' });

    this.logger.log(
      'PUG %s accepted invite for event %d (slot: %s)',
      slot.discordUsername,
      slot.eventId,
      slot.id,
    );
  }

  /**
   * Handle PUG decline button: delete the slot, confirm in DM.
   */
  private async handlePugDecline(
    interaction: ButtonInteraction,
    slot: typeof schema.pugSlots.$inferSelect,
  ): Promise<void> {
    // Delete the PUG slot
    await this.db
      .delete(schema.pugSlots)
      .where(eq(schema.pugSlots.id, slot.id));

    // Edit the original DM to show declined state (remove buttons)
    const declinedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ERROR)
      .setTitle('Invite Declined')
      .setDescription(
        `You declined the invite for **${slot.role}** slot. No worries!`,
      )
      .setTimestamp();

    try {
      await interaction.message.edit({
        embeds: [declinedEmbed],
        components: [],
      });
    } catch {
      // DM edit may fail if message was deleted
    }

    await interaction.editReply({ content: 'Declined.' });

    this.logger.log(
      'PUG %s declined invite for event %d (slot: %s)',
      slot.discordUsername,
      slot.eventId,
      slot.id,
    );
  }
}
