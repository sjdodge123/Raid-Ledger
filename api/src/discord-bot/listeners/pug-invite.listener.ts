import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type GuildMember,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
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
  EMBED_COLORS,
  type MemberInviteCreatedPayload,
} from '../discord-bot.constants';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import { SignupsService } from '../../events/signups.service';
import {
  PugsService,
  type PugSlotCreatedPayload,
} from '../../events/pugs.service';

/** Button ID prefix for the "Join Event" button on invite unfurls (ROK-263) */
const PUG_JOIN_PREFIX = 'pug_join';

/**
 * Listener that bridges NestJS events and Discord.js gateway events
 * for PUG invite flow (ROK-292).
 *
 * 1. Listens for PugSlotCreated → triggers server membership check + invite
 * 2. Registers guildMemberAdd on bot connect → matches pending PUG slots
 * 3. Listens for Discord OAuth login → auto-claims matching PUG slots
 * 4. Accept button → character/role selection (mirrors signup embed flow)
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
    private readonly charactersService: CharactersService,
    private readonly signupsService: SignupsService,
    private readonly pugsService: PugsService,
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
      this.logger.log('Registered guildMemberAdd listener for PUG invite flow');
    }

    // ROK-292: Register interaction handler for PUG accept/decline buttons + select menus
    if (this.boundInteractionHandler) {
      client.removeListener('interactionCreate', this.boundInteractionHandler);
    }

    this.boundInteractionHandler = (
      interaction: import('discord.js').Interaction,
    ) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        void this.handleSelectMenuInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundInteractionHandler);
    this.logger.log('Registered PUG button interaction handler');
  }

  /**
   * When bot disconnects, reset the registration flags.
   * The old client is destroyed, so we need to re-register on next connect.
   * Also clear the stored interaction handler reference to prevent stale closures.
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.guildMemberAddRegistered = false;
    this.boundInteractionHandler = null;
  }

  /**
   * Handle PUG slot created event.
   * Runs async — does not block the API response.
   * Anonymous slots (null discordUsername) are skipped — they use invite links (ROK-263).
   */
  @OnEvent(PUG_SLOT_EVENTS.CREATED)
  async handlePugSlotCreated(payload: PugSlotCreatedPayload): Promise<void> {
    // Skip anonymous slots — they use magic invite links, not bot DMs
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

  /**
   * Handle Discord OAuth login — auto-claim matching PUG slots.
   * ROK-409: Also passes inviteCode for anonymous slot matching.
   */
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
    const [action] = parts;

    // Handle "Join Event" button from invite unfurl (ROK-263)
    if (action === PUG_JOIN_PREFIX) {
      const inviteCode = parts[1];
      await this.handleJoinEventButton(interaction, inviteCode);
      return;
    }

    // Handle member invite buttons (ROK-292) — 3 parts: action:eventId:notificationId
    if (
      action === MEMBER_INVITE_BUTTON_IDS.ACCEPT ||
      action === MEMBER_INVITE_BUTTON_IDS.DECLINE
    ) {
      await this.handleMemberInviteButton(interaction);
      return;
    }

    // PUG buttons have exactly 2 parts: action:pugSlotId
    if (parts.length !== 2) return;
    const pugSlotId = parts[1];

    // Only handle PUG buttons
    if (action !== PUG_BUTTON_IDS.ACCEPT && action !== PUG_BUTTON_IDS.DECLINE) {
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
   * Handle PUG accept button.
   * Mirrors the signup embed flow: character select → role select → confirm.
   * - If user has a linked RL account + characters: show character picker
   * - If MMO event + no characters: show role picker with import nudge
   * - If non-MMO or no game context: accept immediately
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

    const discordUserId = interaction.user.id;

    // Look up linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    // Look up the event for game context
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, slot.eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }

    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    const isMMO = slotConfig?.type === 'mmo';

    // Check for characters if user has a linked account and event has a game
    if (linkedUser && event.registryGameId) {
      const characterList = await this.charactersService.findAllForUser(
        linkedUser.id,
        event.registryGameId,
      );
      const characters = characterList.data;

      if (characters.length > 0) {
        // Show character selection (like signup embed)
        await this.showPugCharacterSelect(
          interaction,
          slot.id,
          event.title,
          characters,
        );
        return;
      }
    }

    // No characters — if MMO, show role picker (with import nudge)
    if (isMMO) {
      await this.showPugRoleSelect(interaction, slot.id, event.title);
      return;
    }

    // Non-MMO, no characters — accept immediately
    await this.finalizePugAccept(interaction, slot, event.title);
  }

  /**
   * Show character selection dropdown for PUG accept flow.
   * Mirrors SignupInteractionListener.showCharacterSelect.
   */
  private async showPugCharacterSelect(
    interaction: ButtonInteraction,
    pugSlotId: string,
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

      return {
        label: char.name,
        value: `${char.id}`,
        description: parts.join(' \u2014 ') || undefined,
        default: characters.length > 1 && mainChar?.id === char.id,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${PUG_BUTTON_IDS.CHARACTER_SELECT}:${pugSlotId}`)
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

  /**
   * Show role selection dropdown for PUG accept flow (MMO events, no characters).
   * Includes a nudge to import characters.
   */
  private async showPugRoleSelect(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    pugSlotId: string,
    eventTitle: string,
    characterInfo?: { name: string; role: string | null },
  ): Promise<void> {
    const customId = characterInfo
      ? `${PUG_BUTTON_IDS.ROLE_SELECT}:${pugSlotId}:${characterInfo.name}`
      : `${PUG_BUTTON_IDS.ROLE_SELECT}:${pugSlotId}`;

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your role')
      .addOptions([
        { label: 'Tank', value: 'tank', emoji: '🛡️' },
        { label: 'Healer', value: 'healer', emoji: '💚' },
        { label: 'DPS', value: 'dps', emoji: '⚔️' },
      ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    let content: string;
    if (characterInfo) {
      const roleHint = characterInfo.role
        ? ` (current: ${characterInfo.role})`
        : '';
      content = `Playing as **${characterInfo.name}**${roleHint} for **${eventTitle}** — select your role:`;
    } else {
      const clientUrl = process.env.CLIENT_URL ?? '';
      const nudge = clientUrl
        ? `\nTip: [Import a character](${clientUrl}/characters) to skip this step next time.`
        : '';
      content = `Select your role for **${eventTitle}**:${nudge}`;
    }

    await interaction.editReply({
      content,
      components: [row],
    });
  }

  /**
   * Handle select menu interactions for PUG character/role selection.
   */
  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length < 2) return;

    const [action, pugSlotId] = parts;

    if (action === PUG_BUTTON_IDS.CHARACTER_SELECT) {
      await this.handlePugCharacterSelectMenu(interaction, pugSlotId);
    } else if (action === PUG_BUTTON_IDS.ROLE_SELECT) {
      // Third segment is optional character name (from character → role flow)
      const characterName =
        parts.length >= 3 ? parts.slice(2).join(':') : undefined;
      await this.handlePugRoleSelectMenu(interaction, pugSlotId, characterName);
    } else if (action === MEMBER_INVITE_BUTTON_IDS.CHARACTER_SELECT) {
      // parts[1] is eventId for member invites
      await this.handleMemberCharacterSelectMenu(interaction, parts[1]);
    } else if (action === MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT) {
      // parts[1] is eventId, parts[2] is optional characterId for member invites
      const characterId = parts.length >= 3 ? parts[2] : undefined;
      await this.handleMemberRoleSelectMenu(interaction, parts[1], characterId);
    }
  }

  /**
   * Handle PUG character selection → show role select (for MMO) or finalize.
   */
  private async handlePugCharacterSelectMenu(
    interaction: StringSelectMenuInteraction,
    pugSlotId: string,
  ): Promise<void> {
    await interaction.deferUpdate();

    const characterId = interaction.values[0];
    const discordUserId = interaction.user.id;

    try {
      const [slot] = await this.db
        .select()
        .from(schema.pugSlots)
        .where(eq(schema.pugSlots.id, pugSlotId))
        .limit(1);

      if (!slot) {
        await interaction.editReply({
          content: 'This invite is no longer valid.',
          components: [],
        });
        return;
      }

      // Find the linked user to look up character details
      const [linkedUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, discordUserId))
        .limit(1);

      if (!linkedUser) {
        await interaction.editReply({
          content: 'Could not find your linked account.',
          components: [],
        });
        return;
      }

      const character = await this.charactersService.findOne(
        linkedUser.id,
        characterId,
      );

      // Check if event is MMO — if so, show role select
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, slot.eventId))
        .limit(1);

      const slotConfig = event?.slotConfig as Record<string, unknown> | null;
      if (slotConfig?.type === 'mmo') {
        await this.showPugRoleSelect(interaction, pugSlotId, event.title, {
          name: character.name,
          role: character.roleOverride ?? character.role ?? null,
        });
        return;
      }

      // Non-MMO: accept with character info, use character's role or default
      const effectiveRole = character.roleOverride ?? character.role ?? 'dps';
      await this.db
        .update(schema.pugSlots)
        .set({
          role: effectiveRole,
          class: character.class ?? null,
          spec: character.spec ?? null,
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(schema.pugSlots.id, pugSlotId));

      // Create signup + roster assignment for the accepted PUG
      await this.createPugSignup(slot, effectiveRole);

      const acceptedEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
        .setTitle('Invite Accepted!')
        .setDescription(
          `You accepted the invite as **${character.name}**! See you at the raid!`,
        )
        .setTimestamp();

      try {
        await interaction.message.edit({
          embeds: [acceptedEmbed],
          components: [],
        });
      } catch {
        // DM edit may fail
      }

      await interaction.editReply({
        content: `Accepted as **${character.name}**!`,
        components: [],
      });

      this.logger.log(
        'PUG %s accepted invite as %s for event %d',
        slot.discordUsername,
        character.name,
        slot.eventId,
      );
    } catch (error) {
      this.logger.error(
        'Error handling PUG character select for slot %s:',
        pugSlotId,
        error,
      );
      try {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Handle PUG role selection → finalize accept with chosen role.
   */
  private async handlePugRoleSelectMenu(
    interaction: StringSelectMenuInteraction,
    pugSlotId: string,
    characterName?: string,
  ): Promise<void> {
    await interaction.deferUpdate();

    const selectedRole = interaction.values[0] as 'tank' | 'healer' | 'dps';

    try {
      const [slot] = await this.db
        .select()
        .from(schema.pugSlots)
        .where(eq(schema.pugSlots.id, pugSlotId))
        .limit(1);

      if (!slot) {
        await interaction.editReply({
          content: 'This invite is no longer valid.',
          components: [],
        });
        return;
      }

      // If we have characterName, look up character to get class/spec
      let charClass: string | null = null;
      let charSpec: string | null = null;

      if (characterName) {
        const discordUserId = interaction.user.id;
        const [linkedUser] = await this.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.discordId, discordUserId))
          .limit(1);

        if (linkedUser && slot.eventId) {
          const [event] = await this.db
            .select()
            .from(schema.events)
            .where(eq(schema.events.id, slot.eventId))
            .limit(1);

          if (event?.registryGameId) {
            const charList = await this.charactersService.findAllForUser(
              linkedUser.id,
              event.registryGameId,
            );
            const char = charList.data.find((c) => c.name === characterName);
            if (char) {
              charClass = char.class ?? null;
              charSpec = char.spec ?? null;
            }
          }
        }
      }

      await this.db
        .update(schema.pugSlots)
        .set({
          role: selectedRole,
          class: charClass,
          spec: charSpec,
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(schema.pugSlots.id, pugSlotId));

      // Create signup + roster assignment for the accepted PUG
      await this.createPugSignup(slot, selectedRole);

      const roleDisplay =
        selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
      const charDisplay = characterName ? ` as **${characterName}**` : '';

      const acceptedEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
        .setTitle('Invite Accepted!')
        .setDescription(
          `You accepted the invite${charDisplay} (${roleDisplay})! See you at the raid!`,
        )
        .setTimestamp();

      try {
        await interaction.message.edit({
          embeds: [acceptedEmbed],
          components: [],
        });
      } catch {
        // DM edit may fail
      }

      await interaction.editReply({
        content: `Accepted${charDisplay} (${roleDisplay})!`,
        components: [],
      });

      this.logger.log(
        'PUG %s accepted invite as %s for event %d',
        slot.discordUsername,
        selectedRole,
        slot.eventId,
      );
    } catch (error) {
      this.logger.error(
        'Error handling PUG role select for slot %s:',
        pugSlotId,
        error,
      );
      try {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Create an event signup + roster assignment for an accepted PUG.
   * Uses linked RL account if available, otherwise creates anonymous signup.
   */
  private async createPugSignup(
    slot: typeof schema.pugSlots.$inferSelect,
    role: string,
  ): Promise<void> {
    const discordUserId = slot.discordUserId;
    if (!discordUserId) return;

    // Look up linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      // Linked user — use SignupsService for full signup + roster assignment
      try {
        const result = await this.signupsService.signup(
          slot.eventId,
          linkedUser.id,
          {
            slotRole: role as
              | 'tank'
              | 'healer'
              | 'dps'
              | 'flex'
              | 'player'
              | 'bench',
          },
        );
        this.logger.log(
          'Created signup %d for PUG %s (linked user %d) on event %d',
          result.id,
          slot.discordUsername,
          linkedUser.id,
          slot.eventId,
        );
      } catch (err) {
        this.logger.warn(
          'Failed to create signup for PUG %s: %s',
          slot.discordUsername,
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
      return;
    }

    // Anonymous PUG — insert signup directly with Discord info
    try {
      const [signup] = await this.db
        .insert(schema.eventSignups)
        .values({
          eventId: slot.eventId,
          discordUserId,
          discordUsername: slot.discordUsername,
          discordAvatarHash: slot.discordAvatarHash,
          confirmationStatus: 'pending',
          status: 'signed_up',
        })
        .onConflictDoNothing()
        .returning();

      if (signup) {
        // Find next available position for the role
        const positionsInRole = await this.db
          .select({ position: schema.rosterAssignments.position })
          .from(schema.rosterAssignments)
          .where(
            and(
              eq(schema.rosterAssignments.eventId, slot.eventId),
              eq(schema.rosterAssignments.role, role),
            ),
          );
        const nextPosition =
          positionsInRole.reduce((max, r) => Math.max(max, r.position), 0) + 1;

        await this.db.insert(schema.rosterAssignments).values({
          eventId: slot.eventId,
          signupId: signup.id,
          role,
          position: nextPosition,
          isOverride: 0,
        });

        this.logger.log(
          'Created anonymous signup %d for PUG %s on event %d (%s slot %d)',
          signup.id,
          slot.discordUsername,
          slot.eventId,
          role,
          nextPosition,
        );
      }
    } catch (err) {
      this.logger.warn(
        'Failed to create anonymous signup for PUG %s: %s',
        slot.discordUsername,
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }

  /**
   * Finalize PUG accept (no character/role selection needed).
   */
  private async finalizePugAccept(
    interaction: ButtonInteraction,
    slot: typeof schema.pugSlots.$inferSelect,
    eventTitle: string,
  ): Promise<void> {
    await this.db
      .update(schema.pugSlots)
      .set({
        status: 'accepted',
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, slot.id));

    // Create signup + roster assignment for the accepted PUG
    await this.createPugSignup(slot, slot.role);

    const acceptedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
      .setTitle('Invite Accepted!')
      .setDescription(
        `You accepted the invite for **${eventTitle}**! See you there!`,
      )
      .setTimestamp();

    try {
      await interaction.message.edit({
        embeds: [acceptedEmbed],
        components: [],
      });
    } catch {
      // DM edit may fail
    }

    await interaction.editReply({ content: 'Accepted!' });

    this.logger.log(
      'PUG %s accepted invite for event %d',
      slot.discordUsername,
      slot.eventId,
    );
  }

  /**
   * Handle PUG decline button: delete the slot, confirm in DM.
   */
  private async handlePugDecline(
    interaction: ButtonInteraction,
    slot: typeof schema.pugSlots.$inferSelect,
  ): Promise<void> {
    // Remove any signup created when the PUG accepted
    if (slot.discordUserId) {
      try {
        await this.signupsService.cancelByDiscordUser(
          slot.eventId,
          slot.discordUserId,
        );
      } catch {
        // No signup to cancel — that's fine
      }
    }

    // Delete the PUG slot
    await this.db
      .delete(schema.pugSlots)
      .where(eq(schema.pugSlots.id, slot.id));

    // Edit the original DM to show declined state (remove buttons)
    const declinedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ERROR)
      .setTitle('Invite Declined')
      .setDescription('You declined the invite. No worries!')
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

  // ====================================================================
  // "Join Event" Button Handler (ROK-263)
  // For unfurled invite links — smart matching
  // ====================================================================

  /**
   * Handle "Join Event" button from invite link unfurl.
   * Smart matching:
   * 1. Has linked RL account + already signed up -> "Already signed up"
   * 2. Has linked RL account -> create normal signup, delete PUG slot -> "You've joined!"
   * 3. No RL account -> ephemeral with web link
   */
  private async handleJoinEventButton(
    interaction: ButtonInteraction,
    inviteCode: string,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const slot = await this.pugsService.findByInviteCode(inviteCode);
      if (!slot) {
        await interaction.editReply({
          content: 'This invite is no longer valid.',
        });
        return;
      }

      // Look up event
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, slot.eventId))
        .limit(1);

      if (!event || event.cancelledAt) {
        await interaction.editReply({
          content: 'This event is no longer available.',
        });
        return;
      }

      // Look up linked RL account
      const [linkedUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, interaction.user.id))
        .limit(1);

      if (!linkedUser) {
        // No RL account — direct to web
        const clientUrl = process.env.CLIENT_URL ?? '';
        const inviteUrl = `${clientUrl}/i/${inviteCode}`;
        await interaction.editReply({
          content: `You need a Raid Ledger account to join. Click here to sign up:\n${inviteUrl}`,
        });
        return;
      }

      // Check if already signed up
      const [existingSignup] = await this.db
        .select({ id: schema.eventSignups.id })
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, slot.eventId),
            eq(schema.eventSignups.userId, linkedUser.id),
          ),
        )
        .limit(1);

      if (existingSignup) {
        await interaction.editReply({
          content: "You're already signed up for this event!",
        });
        return;
      }

      // Create normal signup (not PUG) — use the slot's role
      try {
        await this.signupsService.signup(slot.eventId, linkedUser.id, {
          slotRole: slot.role as 'tank' | 'healer' | 'dps',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to sign up';
        await interaction.editReply({ content: msg });
        return;
      }

      // Delete the anonymous PUG slot
      await this.db
        .delete(schema.pugSlots)
        .where(eq(schema.pugSlots.id, slot.id));

      await interaction.editReply({
        content: `You've joined **${event.title}**! Check the event page for details.`,
      });

      this.logger.log(
        'Discord user %s joined event %d via invite link %s',
        interaction.user.username,
        slot.eventId,
        inviteCode,
      );
    } catch (error) {
      this.logger.error(
        'Error handling Join Event button for invite %s:',
        inviteCode,
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

  // ====================================================================
  // Member Invite Handlers (ROK-292)
  // For registered users: Accept creates event signup + character/role selection
  // ====================================================================

  /**
   * Listen for member invite created event → send Discord DM with buttons.
   */
  @OnEvent(MEMBER_INVITE_EVENTS.CREATED)
  async handleMemberInviteCreated(
    payload: MemberInviteCreatedPayload,
  ): Promise<void> {
    this.logger.debug(
      'Processing member invite: event %d → Discord %s',
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

  /**
   * Handle member invite Accept/Decline button interactions.
   * Format: `member_accept:eventId:notificationId` or `member_decline:eventId:notificationId`
   */
  private async handleMemberInviteButton(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length < 3) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);

    await interaction.deferReply({ ephemeral: true });

    try {
      if (action === MEMBER_INVITE_BUTTON_IDS.ACCEPT) {
        await this.handleMemberAccept(interaction, eventId);
      } else if (action === MEMBER_INVITE_BUTTON_IDS.DECLINE) {
        await this.handleMemberDecline(interaction, eventId);
      }
    } catch (error) {
      this.logger.error(
        'Error handling member invite button for event %d:',
        eventId,
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
   * Handle member invite Accept: sign up + character/role selection.
   */
  private async handleMemberAccept(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const discordUserId = interaction.user.id;

    // Look up linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (!linkedUser) {
      await interaction.editReply({
        content:
          'Could not find your linked account. Please sign up via the web app.',
      });
      return;
    }

    // Look up the event
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event || event.cancelledAt) {
      await interaction.editReply({
        content: 'This event is no longer available.',
      });
      return;
    }

    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    const isMMO = slotConfig?.type === 'mmo';

    // Check for characters if event has a game
    if (event.registryGameId) {
      const characterList = await this.charactersService.findAllForUser(
        linkedUser.id,
        event.registryGameId,
      );
      const characters = characterList.data;

      if (characters.length > 0) {
        // Show character selection (signup deferred until after selection)
        await this.showMemberCharacterSelect(
          interaction,
          eventId,
          event.title,
          characters,
        );
        return;
      }
    }

    // No characters — if MMO, show role picker (signup deferred until role selected)
    if (isMMO) {
      await this.showMemberRoleSelect(interaction, eventId, event.title);
      return;
    }

    // Non-MMO, no characters — sign up immediately
    await this.finalizeMemberAccept(
      interaction,
      eventId,
      linkedUser.id,
      event.title,
    );
  }

  /**
   * Handle member invite Decline: cancel signup (if any), edit DM, confirm.
   */
  private async handleMemberDecline(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    // Remove the signup + roster assignment if the user had already accepted
    const discordUserId = interaction.user.id;
    try {
      await this.signupsService.cancelByDiscordUser(eventId, discordUserId);
      this.logger.log(
        'Cancelled signup for Discord user %s on event %d via decline',
        discordUserId,
        eventId,
      );
    } catch {
      // No signup to cancel (user never accepted) — that's fine
    }

    const declinedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ERROR)
      .setTitle('Invite Declined')
      .setDescription('You declined the invite. No worries!')
      .setTimestamp();

    try {
      await interaction.message.edit({
        embeds: [declinedEmbed],
        components: [],
      });
    } catch {
      // DM edit may fail
    }

    await interaction.editReply({ content: 'Declined.' });
    this.logger.log('Member declined invite for event %d', eventId);
  }

  /**
   * Show character selection dropdown for member invite Accept flow.
   */
  private async showMemberCharacterSelect(
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
      if (char.level) parts.push(`Level ${char.level}`);
      if (char.isMain) parts.push('\u2B50');

      return {
        label: char.name,
        value: `${char.id}`,
        description: parts.join(' \u2014 ') || undefined,
        default: characters.length > 1 && mainChar?.id === char.id,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${MEMBER_INVITE_BUTTON_IDS.CHARACTER_SELECT}:${eventId}`)
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

  /**
   * Show role selection dropdown for member invite Accept flow (MMO, no characters).
   */
  private async showMemberRoleSelect(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    eventId: number,
    eventTitle: string,
    characterInfo?: { id: string; name: string; role: string | null },
  ): Promise<void> {
    const customId = characterInfo
      ? `${MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT}:${eventId}:${characterInfo.id}`
      : `${MEMBER_INVITE_BUTTON_IDS.ROLE_SELECT}:${eventId}`;

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your role')
      .addOptions([
        { label: 'Tank', value: 'tank', emoji: '🛡️' },
        { label: 'Healer', value: 'healer', emoji: '💚' },
        { label: 'DPS', value: 'dps', emoji: '⚔️' },
      ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    let content: string;
    if (characterInfo) {
      const roleHint = characterInfo.role
        ? ` (current: ${characterInfo.role})`
        : '';
      content = `Playing as **${characterInfo.name}**${roleHint} for **${eventTitle}** — select your role:`;
    } else {
      const clientUrl = process.env.CLIENT_URL ?? '';
      const nudge = clientUrl
        ? `\nTip: [Import a character](${clientUrl}/characters) to skip this step next time.`
        : '';
      content = `Select your role for **${eventTitle}**:${nudge}`;
    }

    await interaction.editReply({ content, components: [row] });
  }

  /**
   * Handle member character selection → show role select if MMO, or create signup for non-MMO.
   * Signup is deferred until after all selections are made so the role can be used for slot assignment.
   */
  private async handleMemberCharacterSelectMenu(
    interaction: StringSelectMenuInteraction,
    eventIdStr: string,
  ): Promise<void> {
    await interaction.deferUpdate();

    const characterId = interaction.values[0];
    const discordUserId = interaction.user.id;
    const eventId = parseInt(eventIdStr, 10);

    try {
      const [linkedUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, discordUserId))
        .limit(1);

      if (!linkedUser) {
        await interaction.editReply({
          content: 'Could not find your linked account.',
          components: [],
        });
        return;
      }

      const character = await this.charactersService.findOne(
        linkedUser.id,
        characterId,
      );

      // Check if event is MMO — if so, show role select (defer signup until role chosen)
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      const slotConfig = event?.slotConfig as Record<string, unknown> | null;
      if (slotConfig?.type === 'mmo') {
        await this.showMemberRoleSelect(interaction, eventId, event.title, {
          id: characterId,
          name: character.name,
          role: character.roleOverride ?? character.role ?? null,
        });
        return;
      }

      // Non-MMO: create signup now with character's default role
      const effectiveRole = character.roleOverride ?? character.role ?? 'dps';
      let signupResult;
      try {
        signupResult = await this.signupsService.signup(
          eventId,
          linkedUser.id,
          {
            slotRole: effectiveRole,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to sign up';
        await interaction.editReply({ content: msg, components: [] });
        return;
      }

      // Confirm signup with character
      await this.signupsService.confirmSignup(
        eventId,
        signupResult.id,
        linkedUser.id,
        { characterId },
      );

      const acceptedEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
        .setTitle('Invite Accepted!')
        .setDescription(
          `You signed up as **${character.name}**! See you at the event!`,
        )
        .setTimestamp();

      try {
        await interaction.message.edit({
          embeds: [acceptedEmbed],
          components: [],
        });
      } catch {
        // DM edit may fail
      }

      await interaction.editReply({
        content: `Signed up as **${character.name}**!`,
        components: [],
      });
    } catch (error) {
      this.logger.error(
        'Error handling member character select for event %s:',
        eventIdStr,
        error,
      );
      try {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Handle member role selection → create signup with slotRole for roster assignment.
   */
  private async handleMemberRoleSelectMenu(
    interaction: StringSelectMenuInteraction,
    eventIdStr: string,
    characterId?: string,
  ): Promise<void> {
    await interaction.deferUpdate();

    const selectedRole = interaction.values[0] as 'tank' | 'healer' | 'dps';
    const discordUserId = interaction.user.id;
    const eventId = parseInt(eventIdStr, 10);

    try {
      const [linkedUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, discordUserId))
        .limit(1);

      if (!linkedUser) {
        await interaction.editReply({
          content: 'Could not find your linked account.',
          components: [],
        });
        return;
      }

      // Create signup with role preference for automatic roster slot assignment
      let signupResult;
      try {
        signupResult = await this.signupsService.signup(
          eventId,
          linkedUser.id,
          {
            slotRole: selectedRole,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to sign up';
        await interaction.editReply({ content: msg, components: [] });
        return;
      }

      // If character was selected, confirm signup with character
      let characterName: string | undefined;
      if (characterId) {
        try {
          const character = await this.charactersService.findOne(
            linkedUser.id,
            characterId,
          );
          characterName = character.name;
          await this.signupsService.confirmSignup(
            eventId,
            signupResult.id,
            linkedUser.id,
            { characterId },
          );
        } catch {
          // Character confirm is best-effort
        }
      }

      const roleDisplay =
        selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
      const charDisplay = characterName ? ` as **${characterName}**` : '';

      const acceptedEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
        .setTitle('Invite Accepted!')
        .setDescription(
          `You signed up${charDisplay} (${roleDisplay})! See you at the event!`,
        )
        .setTimestamp();

      try {
        await interaction.message.edit({
          embeds: [acceptedEmbed],
          components: [],
        });
      } catch {
        // DM edit may fail
      }

      await interaction.editReply({
        content: `Signed up${charDisplay} (${roleDisplay})!`,
        components: [],
      });

      this.logger.log(
        'Member accepted invite for event %d as %s',
        eventId,
        selectedRole,
      );
    } catch (error) {
      this.logger.error(
        'Error handling member role select for event %s:',
        eventIdStr,
        error,
      );
      try {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Finalize member accept (no character/role selection needed).
   * Creates the signup immediately for non-MMO events with no characters.
   */
  private async finalizeMemberAccept(
    interaction: ButtonInteraction,
    eventId: number,
    userId: number,
    eventTitle: string,
  ): Promise<void> {
    try {
      await this.signupsService.signup(eventId, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign up';
      await interaction.editReply({ content: msg });
      return;
    }

    const acceptedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
      .setTitle('Invite Accepted!')
      .setDescription(`You signed up for **${eventTitle}**! See you there!`)
      .setTimestamp();

    try {
      await interaction.message.edit({
        embeds: [acceptedEmbed],
        components: [],
      });
    } catch {
      // DM edit may fail
    }

    await interaction.editReply({ content: 'Signed up!' });
  }
}
