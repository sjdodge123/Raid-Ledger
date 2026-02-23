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
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import {
  DISCORD_BOT_EVENTS,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
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
    private readonly eventsService: EventsService,
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

    // Defer immediately to capture the interaction token before it expires.
    // This prevents 10062 (Unknown interaction) from slow async operations
    // and 40060 (already acknowledged) from concurrent rapid clicks.
    await interaction.deferReply({ ephemeral: true });

    // Rate limiting — uses editReply since we already deferred
    const cooldownKey = `${interaction.user.id}:${eventId}`;
    const lastInteraction = interactionCooldowns.get(cooldownKey);
    if (lastInteraction && Date.now() - lastInteraction < COOLDOWN_MS) {
      await this.safeEditReply(interaction, {
        content: 'Please wait a moment before trying again.',
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
      await this.safeReply(interaction, {
        content: 'Something went wrong. Please try again.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle the Sign Up button click.
   */
  private async handleSignup(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    // deferReply already called in handleButtonInteraction

    const discordUserId = interaction.user.id;

    // Check if user is already signed up
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      if (existingSignup.status !== 'signed_up') {
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

      // ROK-438: Already signed up — allow character/role change instead of dead-end
      // Only linked users can change characters; anonymous users get a simple message
      const [linkedUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.discordId, discordUserId))
        .limit(1);

      if (!linkedUser) {
        await interaction.editReply({
          content:
            "You're already signed up! Use the Tentative or Decline buttons to change your status.",
        });
        return;
      }

      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event) {
        await interaction.editReply({ content: 'Event not found.' });
        return;
      }

      // Check if event has a game with character support
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

          if (characters.length >= 1) {
            const slotConfig = event.slotConfig as Record<
              string,
              unknown
            > | null;
            const isMMO = slotConfig?.type === 'mmo';

            // No character yet — show character select
            if (!existingSignup.characterId) {
              await this.showCharacterSelect(
                interaction,
                eventId,
                event.title,
                characters,
              );
              return;
            }

            // Has character but no role on MMO event — show role select
            if (isMMO && !existingSignup.character?.role) {
              const currentChar = characters.find(
                (c) => c.id === existingSignup.characterId,
              );
              await this.showRoleSelect(
                interaction,
                eventId,
                existingSignup.characterId,
                currentChar
                  ? {
                      name: currentChar.name,
                      role:
                        currentChar.roleOverride ?? currentChar.role ?? null,
                    }
                  : undefined,
              );
              return;
            }

            // Has character (and role if MMO) — offer to change
            await this.showCharacterSelect(
              interaction,
              eventId,
              event.title,
              characters,
            );
            return;
          }
        }
      }

      // No game, no characters, or no character support — simple message
      await interaction.editReply({
        content:
          "You're already signed up! Use the Tentative or Decline buttons to change your status.",
      });
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

      // ROK-400: Check if event has a game with character support
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

      // No game or game not found — plain signup
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
    // deferReply already called in handleButtonInteraction

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
    // deferReply already called in handleButtonInteraction

    const discordUserId = interaction.user.id;
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      // Fully remove the signup (cascade deletes roster assignment too)
      await this.signupsService.cancelByDiscordUser(eventId, discordUserId);

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
    // deferReply already called in handleButtonInteraction

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

    // ROK-452: Allow multi-role selection (1-3 roles)
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your preferred role(s)')
      .setMinValues(1)
      .setMaxValues(3)
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
      ? `Signing up as **${characterInfo.name}**${roleHint} — select your preferred role(s):`
      : 'Select your preferred role(s):';

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

    // ROK-452: Support multiple selected roles
    const selectedRoles = interaction.values as ('tank' | 'healer' | 'dps')[];
    const primaryRole = selectedRoles[0];
    const rolesLabel = selectedRoles
      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
      .join(', ');

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

        // ROK-452: Pass preferred roles for auto-allocation; use primary role
        // as slotRole only when a single role is selected (backward compat)
        const signupResult = await this.signupsService.signup(
          eventId,
          linkedUser.id,
          selectedRoles.length === 1
            ? { slotRole: primaryRole, preferredRoles: selectedRoles }
            : { preferredRoles: selectedRoles },
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
          content: `Signed up as **${character.name}** (${rolesLabel})!`,
          components: [],
        });

        await this.updateEmbedSignupCount(eventId);
        return;
      }

      // Anonymous (unlinked) user — existing Path B behavior
      // ROK-452: Pass preferred roles for auto-allocation
      await this.signupsService.signupDiscord(eventId, {
        discordUserId: interaction.user.id,
        discordUsername: interaction.user.username,
        discordAvatarHash: interaction.user.avatar,
        role: selectedRoles.length === 1 ? primaryRole : undefined,
        preferredRoles: selectedRoles,
      });

      const clientUrl = process.env.CLIENT_URL ?? '';
      const accountLink = clientUrl
        ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
        : '';

      await interaction.editReply({
        content: `You're signed up as **${interaction.user.username}** (${rolesLabel})!${accountLink}`,
        components: [],
      });

      await this.updateEmbedSignupCount(eventId);
    } catch (error) {
      this.logger.error(
        `Error handling role select for event ${eventId}:`,
        error,
      );
      await this.safeEditReply(interaction, {
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
      await this.safeEditReply(interaction, {
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    }
  }

  /**
   * Safely reply to an interaction, catching Discord API errors for
   * already-acknowledged (40060) or expired (10062) interactions.
   */
  private async safeReply(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    options: { content: string; ephemeral?: boolean },
  ): Promise<void> {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: options.content });
      } else {
        await interaction.reply(options);
      }
    } catch (error: unknown) {
      if (this.isDiscordInteractionError(error)) {
        this.logger.warn(
          `Interaction response failed (code ${(error as { code: number }).code}): ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Safely edit a deferred/replied interaction, catching Discord API errors
   * for expired (10062) or already-acknowledged (40060) interactions.
   */
  private async safeEditReply(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    options: Parameters<ButtonInteraction['editReply']>[0],
  ): Promise<void> {
    try {
      await interaction.editReply(options);
    } catch (error: unknown) {
      if (this.isDiscordInteractionError(error)) {
        this.logger.warn(
          `Interaction editReply failed (code ${(error as { code: number }).code}): ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Check if an error is a Discord API error for interaction race conditions.
   * Code 40060 = Interaction has already been acknowledged
   * Code 10062 = Unknown interaction (token expired)
   */
  private isDiscordInteractionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ((error as { code: number }).code === 40060 ||
        (error as { code: number }).code === 10062)
    );
  }

  /**
   * Update the embed to reflect current signup count.
   * Uses the shared buildEmbedEventData helper for consistent data fetching.
   */
  private async updateEmbedSignupCount(eventId: number): Promise<void> {
    try {
      const eventData = await this.eventsService.buildEmbedEventData(eventId);

      const guildId = this.clientService.getGuildId();
      if (!guildId) return;

      // Find all embed messages for this event
      const records = await this.db
        .select()
        .from(schema.discordEventMessages)
        .where(
          and(
            eq(schema.discordEventMessages.eventId, eventId),
            eq(schema.discordEventMessages.guildId, guildId),
          ),
        );

      if (records.length === 0) return;

      const [branding, timezone] = await Promise.all([
        this.settingsService.getBranding(),
        this.settingsService.getDefaultTimezone(),
      ]);
      const context: EmbedContext = {
        communityName: branding.communityName,
        clientUrl: process.env.CLIENT_URL ?? null,
        timezone,
      };

      for (const record of records) {
        try {
          const currentState =
            record.embedState as import('../discord-bot.constants').EmbedState;
          const { embed, row } = this.embedFactory.buildEventEmbed(
            eventData,
            context,
            { state: currentState },
          );

          await this.clientService.editEmbed(
            record.channelId,
            record.messageId,
            embed,
            row,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to update embed message ${record.messageId} for event ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to update embed signup count for event ${eventId}:`,
        error,
      );
    }
  }
}
