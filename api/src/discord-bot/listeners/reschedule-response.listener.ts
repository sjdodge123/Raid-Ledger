import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type Interaction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import {
  DISCORD_BOT_EVENTS,
  RESCHEDULE_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';

/**
 * Handles Confirm / Decline button interactions on reschedule DMs (ROK-537).
 *
 * Flow:
 * - Confirm → character/role selection ephemeral (reuses signup patterns)
 *   → re-confirms signup for the new time
 * - Decline → removes signup with `declined` status (excused), deletes roster
 *   assignment, syncs embed
 */
@Injectable()
export class RescheduleResponseListener {
  private readonly logger = new Logger(RescheduleResponseListener.name);
  private boundHandler: ((interaction: Interaction) => void) | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
    private readonly eventsService: EventsService,
    private readonly charactersService: CharactersService,
    private readonly embedSyncQueue: EmbedSyncQueueService,
    private readonly emojiService: DiscordEmojiService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        void this.handleSelectMenuInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered reschedule response interaction handler');
  }

  // ─── Button handler ────────────────────────────────────────────────

  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length !== 2) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) return;

    if (
      action !== RESCHEDULE_BUTTON_IDS.CONFIRM &&
      action !== RESCHEDULE_BUTTON_IDS.TENTATIVE &&
      action !== RESCHEDULE_BUTTON_IDS.DECLINE
    ) {
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      this.logger.warn(
        'Failed to defer for reschedule interaction %s: %s',
        interaction.id,
        error,
      );
      return;
    }

    try {
      if (action === RESCHEDULE_BUTTON_IDS.CONFIRM) {
        await this.handleConfirm(interaction, eventId);
      } else if (action === RESCHEDULE_BUTTON_IDS.TENTATIVE) {
        await this.handleTentative(interaction, eventId);
      } else {
        await this.handleDecline(interaction, eventId);
      }
    } catch (error) {
      this.logger.error(
        'Error handling reschedule interaction for event %d:',
        eventId,
        error,
      );
      await this.safeEditReply(interaction, {
        content: 'Something went wrong. Please try again.',
      });
    }
  }

  // ─── Confirm flow ──────────────────────────────────────────────────

  private async handleConfirm(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }
    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
      });
      return;
    }

    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      interaction.user.id,
    );
    if (!existingSignup) {
      await interaction.editReply({
        content: "You're not signed up for this event.",
      });
      return;
    }

    // Check if user has a linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, interaction.user.id))
      .limit(1);

    if (linkedUser) {
      await this.handleLinkedConfirm(interaction, event, linkedUser);
    } else {
      await this.handleUnlinkedConfirm(interaction, event);
    }
  }

  /**
   * Linked user confirm: check for characters → character select → role select → re-confirm.
   */
  private async handleLinkedConfirm(
    interaction: ButtonInteraction,
    event: EventRow,
    linkedUser: { id: number },
  ): Promise<void> {
    if (event.gameId) {
      const [game] = await this.db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, event.gameId))
        .limit(1);

      if (game) {
        const characterList = await this.charactersService.findAllForUser(
          linkedUser.id,
          event.gameId,
        );
        const characters = characterList.data;
        const slotConfig = event.slotConfig as Record<string, unknown> | null;

        // MMO events: always show character select when characters exist
        if (slotConfig?.type === 'mmo' && characters.length >= 1) {
          await this.showCharacterSelect(
            interaction,
            event.id,
            event.title,
            characters,
          );
          return;
        }

        if (characters.length > 1) {
          await this.showCharacterSelect(
            interaction,
            event.id,
            event.title,
            characters,
          );
          return;
        }

        if (characters.length === 1) {
          const char = characters[0];
          // Non-MMO: auto-select character and re-confirm immediately
          await this.reconfirmSignup(interaction, event, linkedUser.id, {
            characterId: char.id,
          });
          await interaction.editReply({
            content: `You're confirmed for **${event.title}** with **${char.name}**.`,
          });
          await this.editDmEmbed(interaction, 'confirmed');
          await this.embedSyncQueue.enqueue(event.id, 'reschedule-confirm');
          return;
        }

        // No characters — for MMO events, show role select
        if (slotConfig?.type === 'mmo') {
          await this.showRoleSelect(interaction, event.id);
          return;
        }
      }
    }

    // No game or no characters — re-confirm immediately
    await this.reconfirmSignup(interaction, event, linkedUser.id);
    await interaction.editReply({
      content: `You're confirmed for **${event.title}**.`,
    });
    await this.editDmEmbed(interaction, 'confirmed');
    await this.embedSyncQueue.enqueue(event.id, 'reschedule-confirm');
  }

  /**
   * Unlinked user confirm: check for MMO role requirement, otherwise re-confirm.
   */
  private async handleUnlinkedConfirm(
    interaction: ButtonInteraction,
    event: EventRow,
  ): Promise<void> {
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type === 'mmo') {
      await this.showRoleSelect(interaction, event.id);
      return;
    }

    // Non-MMO: re-confirm immediately
    await this.reconfirmSignup(interaction, event);
    await interaction.editReply({
      content: `You're confirmed for **${event.title}**.`,
    });
    await this.editDmEmbed(interaction, 'confirmed');
    await this.embedSyncQueue.enqueue(event.id, 'reschedule-confirm');
  }

  // ─── Tentative flow ────────────────────────────────────────────────

  private async handleTentative(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }
    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
      });
      return;
    }

    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      interaction.user.id,
    );
    if (!existingSignup) {
      await interaction.editReply({
        content: "You're not signed up for this event.",
      });
      return;
    }

    // Set status to tentative
    await this.signupsService.updateStatus(
      eventId,
      existingSignup.discordUserId
        ? { discordUserId: existingSignup.discordUserId }
        : { userId: existingSignup.user.id },
      { status: 'tentative' },
    );

    await interaction.editReply({
      content: `You're marked as **tentative** for **${event.title}**.`,
    });

    await this.editDmEmbed(interaction, 'tentative');
    await this.embedSyncQueue.enqueue(eventId, 'reschedule-tentative');

    this.logger.log(
      'Discord user %s marked tentative for rescheduled event %d (%s)',
      interaction.user.id,
      eventId,
      event.title,
    );
  }

  // ─── Decline flow ──────────────────────────────────────────────────

  private async handleDecline(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }
    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
      });
      return;
    }

    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      interaction.user.id,
    );
    if (!existingSignup) {
      await interaction.editReply({
        content: "You're not signed up for this event.",
      });
      return;
    }

    // Set status to declined + clear roachedOutAt
    await this.db
      .update(schema.eventSignups)
      .set({ status: 'declined', roachedOutAt: null })
      .where(eq(schema.eventSignups.id, existingSignup.id));

    // Delete roster assignment
    await this.db
      .delete(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, existingSignup.id),
        ),
      );

    await interaction.editReply({
      content: `You've been removed from **${event.title}**. No worries!`,
    });

    await this.editDmEmbed(interaction, 'declined');
    await this.embedSyncQueue.enqueue(eventId, 'reschedule-decline');

    this.logger.log(
      'Discord user %s declined reschedule for event %d (%s)',
      interaction.user.id,
      eventId,
      event.title,
    );
  }

  // ─── Select menu handler ───────────────────────────────────────────

  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length < 2 || parts.length > 3) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) return;

    if (
      action !== RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT &&
      action !== RESCHEDULE_BUTTON_IDS.ROLE_SELECT
    ) {
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch (error) {
      this.logger.warn(
        'Failed to defer select menu interaction %s: %s',
        interaction.id,
        error,
      );
      return;
    }

    try {
      if (action === RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT) {
        await this.handleCharacterSelect(interaction, eventId);
      } else {
        const characterId = parts.length === 3 ? parts[2] : undefined;
        await this.handleRoleSelect(interaction, eventId, characterId);
      }
    } catch (error) {
      this.logger.error(
        'Error handling reschedule select menu for event %d:',
        eventId,
        error,
      );
      await this.safeEditReply(interaction, {
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    }
  }

  /**
   * Handle character selection from reschedule confirm flow.
   */
  private async handleCharacterSelect(
    interaction: StringSelectMenuInteraction,
    eventId: number,
  ): Promise<void> {
    const characterId = interaction.values[0];
    const discordUserId = interaction.user.id;

    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (!linkedUser) {
      await interaction.editReply({
        content: 'Could not find your linked account. Please try again.',
        components: [],
      });
      return;
    }

    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply({
        content: 'Event not found.',
        components: [],
      });
      return;
    }

    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
        components: [],
      });
      return;
    }

    // Check if MMO — if so, show role select with character context
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type === 'mmo') {
      const character = await this.charactersService.findOne(
        linkedUser.id,
        characterId,
      );
      await this.showRoleSelect(interaction, eventId, characterId, {
        name: character.name,
        role: character.roleOverride ?? character.role ?? null,
      });
      return;
    }

    // Non-MMO: re-confirm with character
    await this.reconfirmSignup(interaction, event, linkedUser.id, {
      characterId,
    });
    const character = await this.charactersService.findOne(
      linkedUser.id,
      characterId,
    );

    await interaction.editReply({
      content: `You're confirmed for **${event.title}** with **${character.name}**.`,
      components: [],
    });
    await this.editDmEmbedFromSelect(interaction, 'confirmed');
    await this.embedSyncQueue.enqueue(eventId, 'reschedule-confirm');
  }

  /**
   * Handle role selection from reschedule confirm flow.
   */
  private async handleRoleSelect(
    interaction: StringSelectMenuInteraction,
    eventId: number,
    characterId?: string,
  ): Promise<void> {
    const selectedRoles = interaction.values as ('tank' | 'healer' | 'dps')[];
    const primaryRole = selectedRoles[0];
    const rolesLabel = selectedRoles
      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
      .join(', ');

    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply({
        content: 'Event not found.',
        components: [],
      });
      return;
    }

    if (event.cancelledAt) {
      await interaction.editReply({
        content: 'This event has been cancelled.',
        components: [],
      });
      return;
    }

    const discordUserId = interaction.user.id;
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      await this.reconfirmSignup(interaction, event, linkedUser.id, {
        characterId,
        preferredRoles: selectedRoles,
        slotRole: selectedRoles.length === 1 ? primaryRole : undefined,
      });

      const charName = characterId
        ? (await this.charactersService.findOne(linkedUser.id, characterId))
            .name
        : null;

      await interaction.editReply({
        content: charName
          ? `You're confirmed for **${event.title}** with **${charName}** (${rolesLabel}).`
          : `You're confirmed for **${event.title}** (${rolesLabel}).`,
        components: [],
      });
    } else {
      // Unlinked user — re-confirm with role
      await this.reconfirmSignup(interaction, event, undefined, {
        preferredRoles: selectedRoles,
        slotRole: selectedRoles.length === 1 ? primaryRole : undefined,
      });

      await interaction.editReply({
        content: `You're confirmed for **${event.title}** (${rolesLabel}).`,
        components: [],
      });
    }

    await this.editDmEmbedFromSelect(interaction, 'confirmed');
    await this.embedSyncQueue.enqueue(eventId, 'reschedule-confirm');
  }

  // ─── Shared helpers ────────────────────────────────────────────────

  private async showCharacterSelect(
    interaction: ButtonInteraction,
    eventId: number,
    eventTitle: string,
    characters: import('@raid-ledger/contract').CharacterDto[],
  ): Promise<void> {
    const mainChar = characters.find((c) => c.isMain);

    const options = characters.slice(0, 25).map((char) => {
      const parts: string[] = [];
      if (char.class) {
        parts.push(char.spec ? `${char.class} (${char.spec})` : char.class);
      }
      if (char.level) {
        parts.push(`Level ${char.level}`);
      }
      if (char.isMain) {
        parts.push('\u2B50');
      }

      const classEmoji = char.class
        ? this.emojiService.getClassEmojiComponent(char.class)
        : undefined;

      return {
        label: char.name,
        value: char.id,
        description: parts.join(' \u2014 ') || undefined,
        emoji: classEmoji,
        default: characters.length > 1 && mainChar?.id === char.id,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:${eventId}`)
      .setPlaceholder('Select a character')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    await interaction.editReply({
      content: `Pick a character for **${eventTitle}**`,
      components: [row],
    });
  }

  private async showRoleSelect(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    eventId: number,
    characterId?: string,
    characterInfo?: { name: string; role: string | null },
  ): Promise<void> {
    const customId = characterId
      ? `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:${eventId}:${characterId}`
      : `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:${eventId}`;

    const roleOptions: Array<{
      label: string;
      value: string;
      emoji?: import('discord.js').ComponentEmojiResolvable;
    }> = [
      {
        label: 'Tank',
        value: 'tank',
        emoji: this.emojiService.getRoleEmojiComponent('tank'),
      },
      {
        label: 'Healer',
        value: 'healer',
        emoji: this.emojiService.getRoleEmojiComponent('healer'),
      },
      {
        label: 'DPS',
        value: 'dps',
        emoji: this.emojiService.getRoleEmojiComponent('dps'),
      },
    ];

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your preferred role(s)')
      .setMinValues(1)
      .setMaxValues(3)
      .addOptions(roleOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const roleHint = characterInfo?.role
      ? ` (current: ${characterInfo.role})`
      : '';
    const content = characterInfo
      ? `Confirming as **${characterInfo.name}**${roleHint} — select your preferred role(s):`
      : 'Select your preferred role(s):';

    await interaction.editReply({
      content,
      components: [row],
    });
  }

  /**
   * Re-confirm an existing signup: set status to `signed_up` and optionally
   * update character/role.
   */
  private async reconfirmSignup(
    _interaction: ButtonInteraction | StringSelectMenuInteraction,
    event: EventRow,
    userId?: number,
    options?: {
      characterId?: string;
      preferredRoles?: ('tank' | 'healer' | 'dps')[];
      slotRole?: string;
    },
  ): Promise<void> {
    const updateSet: Record<string, unknown> = {
      status: 'signed_up',
      roachedOutAt: null,
    };

    if (options?.preferredRoles) {
      updateSet.preferredRoles = options.preferredRoles;
    } else if (options?.slotRole) {
      // Single role selection stored as preferredRoles array
      updateSet.preferredRoles = [options.slotRole];
    }

    if (userId) {
      // Linked user
      const [signup] = await this.db
        .select()
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, event.id),
            eq(schema.eventSignups.userId, userId),
          ),
        )
        .limit(1);

      if (!signup) return;

      await this.db
        .update(schema.eventSignups)
        .set(updateSet)
        .where(eq(schema.eventSignups.id, signup.id));

      // Update character if provided
      if (options?.characterId) {
        await this.signupsService.confirmSignup(event.id, signup.id, userId, {
          characterId: options.characterId,
        });
      }
    } else {
      // Unlinked user — find by discordUserId
      const [signup] = await this.db
        .select()
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, event.id),
            eq(schema.eventSignups.discordUserId, _interaction.user.id),
          ),
        )
        .limit(1);

      if (!signup) return;

      await this.db
        .update(schema.eventSignups)
        .set(updateSet)
        .where(eq(schema.eventSignups.id, signup.id));
    }
  }

  private async lookupEvent(eventId: number): Promise<EventRow | null> {
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        cancelledAt: schema.events.cancelledAt,
        gameId: schema.events.gameId,
        slotConfig: schema.events.slotConfig,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    return event ?? null;
  }

  /**
   * Edit the original DM embed to show confirmed/declined state and disable buttons.
   */
  private async editDmEmbed(
    interaction: ButtonInteraction,
    state: 'confirmed' | 'tentative' | 'declined',
  ): Promise<void> {
    try {
      const originalMessage = interaction.message;
      const originalEmbed = originalMessage.embeds[0];
      if (!originalEmbed) return;

      const { EmbedBuilder } = await import('discord.js');
      const updatedEmbed = EmbedBuilder.from(originalEmbed);

      const stateLabels: Record<string, string> = {
        confirmed: '\n\n**\u2705 Confirmed for new time**',
        tentative: '\n\n**\u2753 Tentative**',
        declined: '\n\n**\u274C Declined**',
      };
      const stateText = stateLabels[state];
      const originalDescription = originalEmbed.description ?? '';
      updatedEmbed.setDescription(`${originalDescription}${stateText}`);

      // Disable all interactive buttons (keep URL buttons)
      const updatedComponents: ActionRowBuilder<ButtonBuilder>[] = [];
      for (const row of originalMessage.components) {
        if (row.type !== ComponentType.ActionRow) continue;

        const newRow = new ActionRowBuilder<ButtonBuilder>();
        for (const component of row.components) {
          if (component.type === ComponentType.Button) {
            const btn = ButtonBuilder.from(component);
            if (
              'customId' in component &&
              typeof component.customId === 'string'
            ) {
              btn.setDisabled(true);
            }
            newRow.addComponents(btn);
          }
        }
        if (newRow.components.length > 0) {
          updatedComponents.push(newRow);
        }
      }

      await originalMessage.edit({
        embeds: [updatedEmbed],
        components: updatedComponents,
      });
    } catch (error) {
      this.logger.warn(
        'Failed to edit reschedule DM embed: %s',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Edit the DM embed from a select menu interaction context.
   * Select menus fire on a follow-up message, so we reach the original DM
   * via the interaction's message reference.
   */
  private async editDmEmbedFromSelect(
    interaction: StringSelectMenuInteraction,
    state: 'confirmed' | 'declined',
  ): Promise<void> {
    try {
      // The select menu was shown via editReply on the deferred button interaction.
      // The original DM (with the embed + buttons) is the message the button was on.
      // We can reach it through the channel's message history since this is a DM.
      const channel = interaction.channel;
      if (!channel || !('messages' in channel)) return;

      // The original reschedule DM is the message that contained the buttons.
      // In a DM context, we look for the most recent bot message with an embed
      // that has reschedule button components.
      const messages = await channel.messages.fetch({ limit: 10 });
      const botMessage = messages.find(
        (msg) =>
          msg.author.id === interaction.client.user?.id &&
          msg.embeds.length > 0 &&
          msg.components.some(
            (row) =>
              row.type === ComponentType.ActionRow &&
              row.components.some(
                (c) =>
                  'customId' in c &&
                  typeof c.customId === 'string' &&
                  (c.customId.startsWith(RESCHEDULE_BUTTON_IDS.CONFIRM) ||
                    c.customId.startsWith(RESCHEDULE_BUTTON_IDS.DECLINE)),
              ),
          ),
      );

      if (!botMessage) return;

      const originalEmbed = botMessage.embeds[0];
      if (!originalEmbed) return;

      const { EmbedBuilder } = await import('discord.js');
      const updatedEmbed = EmbedBuilder.from(originalEmbed);

      const stateText =
        state === 'confirmed'
          ? '\n\n**\u2705 Confirmed for new time**'
          : '\n\n**\u274C Declined**';
      const originalDescription = originalEmbed.description ?? '';
      updatedEmbed.setDescription(`${originalDescription}${stateText}`);

      const updatedComponents: ActionRowBuilder<ButtonBuilder>[] = [];
      for (const row of botMessage.components) {
        if (row.type !== ComponentType.ActionRow) continue;

        const newRow = new ActionRowBuilder<ButtonBuilder>();
        for (const component of row.components) {
          if (component.type === ComponentType.Button) {
            const btn = ButtonBuilder.from(component);
            if (
              'customId' in component &&
              typeof component.customId === 'string'
            ) {
              btn.setDisabled(true);
            }
            newRow.addComponents(btn);
          }
        }
        if (newRow.components.length > 0) {
          updatedComponents.push(newRow);
        }
      }

      await botMessage.edit({
        embeds: [updatedEmbed],
        components: updatedComponents,
      });
    } catch (error) {
      this.logger.warn(
        'Failed to edit reschedule DM embed from select: %s',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async safeEditReply(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    options: Parameters<ButtonInteraction['editReply']>[0],
  ): Promise<void> {
    try {
      await interaction.editReply(options);
    } catch (error: unknown) {
      if (this.isDiscordInteractionError(error)) {
        this.logger.warn(
          'Interaction editReply failed (code %d): %s',
          (error as { code: number }).code,
          (error as Error).message,
        );
        return;
      }
      throw error;
    }
  }

  private isDiscordInteractionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ((error as { code: number }).code === 40060 ||
        (error as { code: number }).code === 10062)
    );
  }
}

/** Subset of event row fields needed by this listener. */
interface EventRow {
  id: number;
  title: string;
  cancelledAt: Date | null;
  gameId: number | null;
  slotConfig: unknown;
}
