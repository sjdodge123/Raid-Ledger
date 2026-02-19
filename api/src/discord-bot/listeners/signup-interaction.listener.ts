import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import {
  DISCORD_BOT_EVENTS,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';

/**
 * Rate-limit tracker for signup button interactions.
 * Prevents spam clicks within a cooldown window.
 */
const interactionCooldowns = new Map<string, number>();
const COOLDOWN_MS = 3000; // 3 seconds between interactions per user per event

/**
 * Handles Discord button interactions for event signup actions (ROK-137).
 *
 * Listens for the `discord-bot.connected` event to register the interaction
 * handler on the Discord client.
 */
@Injectable()
export class SignupInteractionListener {
  private readonly logger = new Logger(SignupInteractionListener.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
    private readonly charactersService: CharactersService,
    private readonly intentTokenService: IntentTokenService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Register the interaction handler when the bot connects.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    // Remove only our own listener to prevent duplicates on reconnect
    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        void this.handleSelectMenuInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundHandler);

    this.logger.log('Registered signup interaction handler');
  }

  /**
   * Handle button clicks on event embeds.
   */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const customId = interaction.customId;
    const parts = customId.split(':');
    if (parts.length !== 2) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) return;

    // Check if this is a signup-related button
    const validActions = [
      SIGNUP_BUTTON_IDS.SIGNUP,
      SIGNUP_BUTTON_IDS.TENTATIVE,
      SIGNUP_BUTTON_IDS.DECLINE,
      SIGNUP_BUTTON_IDS.JOIN_SIGNUP,
      SIGNUP_BUTTON_IDS.QUICK_SIGNUP,
    ];
    if (!validActions.includes(action as (typeof validActions)[number])) return;

    // Rate limiting
    const cooldownKey = `${interaction.user.id}:${eventId}`;
    const lastInteraction = interactionCooldowns.get(cooldownKey);
    if (lastInteraction && Date.now() - lastInteraction < COOLDOWN_MS) {
      await interaction.reply({
        content: 'Please wait a moment before trying again.',
        ephemeral: true,
      });
      return;
    }
    interactionCooldowns.set(cooldownKey, Date.now());

    try {
      switch (action) {
        case SIGNUP_BUTTON_IDS.SIGNUP:
          await this.handleSignup(interaction, eventId);
          break;
        case SIGNUP_BUTTON_IDS.TENTATIVE:
          await this.handleTentative(interaction, eventId);
          break;
        case SIGNUP_BUTTON_IDS.DECLINE:
          await this.handleDecline(interaction, eventId);
          break;
        case SIGNUP_BUTTON_IDS.QUICK_SIGNUP:
          await this.handleQuickSignup(interaction, eventId);
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.error(
        `Error handling signup interaction for event ${eventId}:`,
        error,
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Something went wrong. Please try again.',
          ephemeral: true,
        });
      }
    }
  }

  /**
   * Handle the Sign Up button click.
   */
  private async handleSignup(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    // Check if user is already signed up
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      if (existingSignup.status === 'signed_up') {
        await interaction.editReply({
          content:
            "You're already signed up! Use the Tentative or Decline buttons to change your status.",
        });
        return;
      }

      // User has a tentative/declined signup — change to signed_up
      await this.signupsService.updateStatus(
        eventId,
        existingSignup.discordUserId
          ? { discordUserId: existingSignup.discordUserId }
          : { userId: existingSignup.user.id },
        { status: 'signed_up' },
      );

      await interaction.editReply({
        content: 'Your status has been changed to **signed up**!',
      });
      await this.updateEmbedSignupCount(eventId);
      return;
    }

    // Check if Discord user has an RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      // Linked RL user — get event to check for character selection (ROK-138)
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event) {
        await interaction.editReply({ content: 'Event not found.' });
        return;
      }

      // ROK-138: Check if event has a registry game with character support
      if (event.registryGameId) {
        const [game] = await this.db
          .select()
          .from(schema.gameRegistry)
          .where(eq(schema.gameRegistry.id, event.registryGameId))
          .limit(1);

        if (game) {
          const characterList = await this.charactersService.findAllForUser(
            linkedUser.id,
            event.registryGameId,
          );
          const characters = characterList.data;

          const slotConfig = event.slotConfig as Record<string, unknown> | null;

          // ROK-138: For MMO events, always show character select (even with 1 char)
          // so users can see and change their character before role selection
          if (slotConfig?.type === 'mmo' && characters.length >= 1) {
            await this.showCharacterSelect(
              interaction,
              eventId,
              event.title,
              characters,
            );
            return;
          }

          if (characters.length > 1) {
            // Multiple characters, non-MMO — show select dropdown
            await this.showCharacterSelect(
              interaction,
              eventId,
              event.title,
              characters,
            );
            return;
          }

          if (characters.length === 1) {
            const char = characters[0];

            // Non-MMO: auto-select character and sign up immediately
            const signupResult = await this.signupsService.signup(
              eventId,
              linkedUser.id,
            );
            await this.signupsService.confirmSignup(
              eventId,
              signupResult.id,
              linkedUser.id,
              { characterId: char.id },
            );

            await interaction.editReply({
              content: `Signed up as **${char.name}**!`,
            });
            await this.updateEmbedSignupCount(eventId);
            return;
          }

          // No characters for this game — instant signup with nudge if hasRoles
          await this.signupsService.signup(eventId, linkedUser.id);

          const clientUrl = process.env.CLIENT_URL ?? '';
          let nudge = '';
          if (game.hasRoles && clientUrl) {
            nudge = `\nTip: Create a character at ${clientUrl}/characters to get assigned to a role next time.`;
          }

          await interaction.editReply({
            content: `You're signed up for **${event.title}**!${nudge}`,
          });
          await this.updateEmbedSignupCount(eventId);
          return;
        }
      }

      // No registry game or game not found — plain signup
      await this.signupsService.signup(eventId, linkedUser.id);

      await interaction.editReply({
        content: `You're signed up for **${event.title}**!`,
      });

      await this.updateEmbedSignupCount(eventId);
      return;
    }

    // Unlinked Discord user — show onboarding ephemeral
    await this.showOnboardingEphemeral(interaction, eventId);
  }

  /**
   * Handle the Tentative button click.
   */
  private async handleTentative(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      // Update status to tentative
      await this.signupsService.updateStatus(
        eventId,
        existingSignup.discordUserId
          ? { discordUserId: existingSignup.discordUserId }
          : { userId: existingSignup.user.id },
        { status: 'tentative' },
      );

      await interaction.editReply({
        content: "You're marked as **tentative**.",
      });
      await this.updateEmbedSignupCount(eventId);
      return;
    }

    // No existing signup — create one with tentative status
    // Check for linked RL account first
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      await this.signupsService.signup(eventId, linkedUser.id);
      await this.signupsService.updateStatus(
        eventId,
        { userId: linkedUser.id },
        { status: 'tentative' },
      );
    } else {
      await this.signupsService.signupDiscord(eventId, {
        discordUserId,
        discordUsername: interaction.user.username,
        discordAvatarHash: interaction.user.avatar,
        status: 'tentative',
      });
    }

    await interaction.editReply({
      content: "You're marked as **tentative**.",
    });
    await this.updateEmbedSignupCount(eventId);
  }

  /**
   * Handle the Decline button click.
   */
  private async handleDecline(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      await this.signupsService.updateStatus(
        eventId,
        existingSignup.discordUserId
          ? { discordUserId: existingSignup.discordUserId }
          : { userId: existingSignup.user.id },
        { status: 'declined' },
      );

      await interaction.editReply({
        content: "You've **declined** this event.",
      });
      await this.updateEmbedSignupCount(eventId);
      return;
    }

    // No existing signup — create one with declined status
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      await this.signupsService.signup(eventId, linkedUser.id);
      await this.signupsService.updateStatus(
        eventId,
        { userId: linkedUser.id },
        { status: 'declined' },
      );
    } else {
      await this.signupsService.signupDiscord(eventId, {
        discordUserId,
        discordUsername: interaction.user.username,
        discordAvatarHash: interaction.user.avatar,
        status: 'declined',
      });
    }

    await interaction.editReply({
      content: "You've **declined** this event.",
    });
    await this.updateEmbedSignupCount(eventId);
  }

  /**
   * Show the onboarding ephemeral for unlinked Discord users (ROK-137).
   * Presents [Join & Sign Up] and [Quick Sign Up] buttons.
   */
  private async showOnboardingEphemeral(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }

    const clientUrl = process.env.CLIENT_URL ?? '';

    // Generate intent token for deferred signup (Path A)
    const intentToken = this.intentTokenService.generate(
      eventId,
      interaction.user.id,
    );
    const joinUrl = clientUrl
      ? `${clientUrl}/join?intent=signup&eventId=${eventId}&token=${encodeURIComponent(intentToken)}`
      : null;

    const row = new ActionRowBuilder<ButtonBuilder>();

    // Path A: Join & Sign Up (URL button)
    if (joinUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel('Join & Sign Up')
          .setStyle(ButtonStyle.Link)
          .setURL(joinUrl),
      );
    }

    // Path B: Quick Sign Up (interaction button)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:${eventId}`)
        .setLabel('Quick Sign Up')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content: [
        `**Sign up for ${event.title}**`,
        '',
        'Create a Raid Ledger account to manage characters,',
        'get reminders, and track your raid history.',
      ].join('\n'),
      components: [row],
    });
  }

  /**
   * Handle Quick Sign Up for anonymous Discord participants (Path B).
   */
  private async handleQuickSignup(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    // Check if already signed up
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      await interaction.editReply({
        content: "You're already signed up!",
      });
      return;
    }

    // Check if event has role requirements (MMO slot config)
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return;
    }

    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    const isMMO = slotConfig?.type === 'mmo';

    if (isMMO) {
      // Show role select dropdown
      await this.showRoleSelect(interaction, eventId);
      return;
    }

    // No role requirement — instant signup
    await this.signupsService.signupDiscord(eventId, {
      discordUserId,
      discordUsername: interaction.user.username,
      discordAvatarHash: interaction.user.avatar,
    });

    const clientUrl = process.env.CLIENT_URL ?? '';
    const accountLink = clientUrl
      ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
      : '';

    await interaction.editReply({
      content: `You're signed up as **${interaction.user.username}**!${accountLink}`,
    });

    await this.updateEmbedSignupCount(eventId);
  }

  /**
   * Show role selection dropdown for signup flows that require a role.
   * Used by both anonymous (Path B) and linked-user character flows (ROK-138).
   *
   * When `characterId` is provided, it is appended to the customId so the
   * role select handler can complete a linked-user signup with both character
   * and role: `role_select:<eventId>:<characterId>`
   *
   * When `characterInfo` is provided (linked user), the character name is shown
   * in the message and the role dropdown pre-selects based on the character's role.
   */
  private async showRoleSelect(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    eventId: number,
    characterId?: string,
    characterInfo?: { name: string; role: string | null },
  ): Promise<void> {
    const customId = characterId
      ? `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:${eventId}:${characterId}`
      : `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:${eventId}`;

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

    const roleHint = characterInfo?.role
      ? ` (current: ${characterInfo.role})`
      : '';
    const content = characterInfo
      ? `Signing up as **${characterInfo.name}**${roleHint} — select your role:`
      : 'Select your role:';

    await interaction.editReply({
      content,
      components: [row],
    });
  }

  /**
   * Show character selection dropdown for linked users (ROK-138).
   * Does NOT sign the user up yet — signup happens after character selection.
   */
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

      return {
        label: char.name,
        value: char.id,
        description: parts.join(' \u2014 ') || undefined,
        // Only pre-select main when there are multiple characters.
        // With 1 character, pre-selecting prevents Discord from firing
        // the interaction (no "change" detected on click).
        default: characters.length > 1 && mainChar?.id === char.id,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:${eventId}`)
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
   * Handle select menu interactions (role selection for anonymous signup,
   * character selection for linked users).
   */
  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length < 2 || parts.length > 3) return;

    const [action, eventIdStr] = parts;
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) return;

    if (action === SIGNUP_BUTTON_IDS.ROLE_SELECT) {
      // Optional 3rd segment is characterId (linked user role select after character)
      const characterId = parts.length === 3 ? parts[2] : undefined;
      await this.handleRoleSelectMenu(interaction, eventId, characterId);
    } else if (action === SIGNUP_BUTTON_IDS.CHARACTER_SELECT) {
      await this.handleCharacterSelectMenu(interaction, eventId);
    }
  }

  /**
   * Handle role selection for signup flows (ROK-137 anonymous, ROK-138 linked).
   *
   * When `characterId` is provided (linked user), creates a linked signup with
   * both the selected role and character. Otherwise falls back to anonymous signup.
   */
  private async handleRoleSelectMenu(
    interaction: StringSelectMenuInteraction,
    eventId: number,
    characterId?: string,
  ): Promise<void> {
    await interaction.deferUpdate();

    const selectedRole = interaction.values[0] as 'tank' | 'healer' | 'dps';

    try {
      // ROK-138: Linked user with character — signup with role + character
      if (characterId) {
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

        // slotPosition intentionally omitted — service auto-calculates next
        // available position when slotPosition is undefined/0.
        const signupResult = await this.signupsService.signup(
          eventId,
          linkedUser.id,
          { slotRole: selectedRole },
        );
        await this.signupsService.confirmSignup(
          eventId,
          signupResult.id,
          linkedUser.id,
          { characterId },
        );

        const character = await this.charactersService.findOne(
          linkedUser.id,
          characterId,
        );

        await interaction.editReply({
          content: `Signed up as **${character.name}** (${selectedRole})!`,
          components: [],
        });

        await this.updateEmbedSignupCount(eventId);
        return;
      }

      // Anonymous (unlinked) user — existing Path B behavior
      await this.signupsService.signupDiscord(eventId, {
        discordUserId: interaction.user.id,
        discordUsername: interaction.user.username,
        discordAvatarHash: interaction.user.avatar,
        role: selectedRole,
      });

      const clientUrl = process.env.CLIENT_URL ?? '';
      const accountLink = clientUrl
        ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
        : '';

      await interaction.editReply({
        content: `You're signed up as **${interaction.user.username}** (${selectedRole})!${accountLink}`,
        components: [],
      });

      await this.updateEmbedSignupCount(eventId);
    } catch (error) {
      this.logger.error(
        `Error handling role select for event ${eventId}:`,
        error,
      );
      await interaction.editReply({
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    }
  }

  /**
   * Handle character selection for linked users (ROK-138).
   */
  private async handleCharacterSelectMenu(
    interaction: StringSelectMenuInteraction,
    eventId: number,
  ): Promise<void> {
    await interaction.deferUpdate();

    const characterId = interaction.values[0];
    const discordUserId = interaction.user.id;

    try {
      // Find the linked RL user
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

      // ROK-138: Check if event is MMO — if so, show role select before signing up
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (event) {
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
      }

      // Non-MMO: Sign up and confirm with selected character immediately
      const signupResult = await this.signupsService.signup(
        eventId,
        linkedUser.id,
      );
      await this.signupsService.confirmSignup(
        eventId,
        signupResult.id,
        linkedUser.id,
        { characterId },
      );

      // Get character name for confirmation message
      const character = await this.charactersService.findOne(
        linkedUser.id,
        characterId,
      );

      await interaction.editReply({
        content: `Signed up as **${character.name}**!`,
        components: [],
      });

      await this.updateEmbedSignupCount(eventId);
    } catch (error) {
      this.logger.error(
        `Error handling character select for event ${eventId}:`,
        error,
      );
      await interaction.editReply({
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    }
  }

  /**
   * Update the embed to reflect current signup count.
   */
  private async updateEmbedSignupCount(eventId: number): Promise<void> {
    try {
      const roster = await this.signupsService.getRoster(eventId);
      // Count only signed_up and tentative (not declined) for the display count
      const activeCount = roster.signups.filter(
        (s) => s.status !== 'declined',
      ).length;

      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event) return;

      // Query per-role counts from roster_assignments
      const roleRows = await this.db
        .select({
          role: schema.rosterAssignments.role,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.rosterAssignments)
        .where(eq(schema.rosterAssignments.eventId, eventId))
        .groupBy(schema.rosterAssignments.role);

      const roleCounts: Record<string, number> = {};
      for (const row of roleRows) {
        if (row.role) roleCounts[row.role] = row.count;
      }

      // Query signups with Discord IDs and assigned roles for mention display
      const signupRows = await this.db
        .select({
          discordId: sql<string>`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
          role: schema.rosterAssignments.role,
          status: schema.eventSignups.status,
        })
        .from(schema.eventSignups)
        .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
        .leftJoin(
          schema.rosterAssignments,
          eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
        )
        .where(eq(schema.eventSignups.eventId, eventId));

      const signupMentions = signupRows
        .filter((r) => r.status !== 'declined' && r.discordId)
        .map((r) => ({ discordId: r.discordId, role: r.role ?? null }));

      // Build event data for embed update
      const eventData: EmbedEventData = {
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.duration[0].toISOString(),
        endTime: event.duration[1].toISOString(),
        signupCount: activeCount,
        maxAttendees: event.maxAttendees,
        slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
        roleCounts,
        signupMentions,
      };

      // Look up game info if available
      if (event.gameId) {
        const [game] = await this.db
          .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
          .from(schema.games)
          .where(eq(schema.games.igdbId, parseInt(event.gameId, 10)))
          .limit(1);
        if (game) {
          eventData.game = { name: game.name, coverUrl: game.coverUrl };
        }
      }

      const guildId = this.clientService.getGuildId();
      if (!guildId) return;

      // Find the embed message
      const [record] = await this.db
        .select()
        .from(schema.discordEventMessages)
        .where(
          and(
            eq(schema.discordEventMessages.eventId, eventId),
            eq(schema.discordEventMessages.guildId, guildId),
          ),
        )
        .limit(1);

      if (!record) return;

      const branding = await this.settingsService.getBranding();
      const context: EmbedContext = {
        communityName: branding.communityName,
        clientUrl: process.env.CLIENT_URL ?? null,
      };

      const currentState = record.embedState;
      const { embed, row } = this.embedFactory.buildEventUpdate(
        eventData,
        context,
        currentState as import('../discord-bot.constants').EmbedState,
      );

      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
        row,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update embed signup count for event ${eventId}:`,
        error,
      );
    }
  }
}
