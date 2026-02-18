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
  private boundHandler: ((interaction: import('discord.js').Interaction) => void) | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
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
        void this.handleButtonInteraction(interaction as ButtonInteraction);
      } else if (interaction.isStringSelectMenu()) {
        void this.handleSelectMenuInteraction(interaction as StringSelectMenuInteraction);
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
      // Linked RL user — get event to check if character is required
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event) {
        await interaction.editReply({ content: 'Event not found.' });
        return;
      }

      // Sign up the linked user
      await this.signupsService.signup(eventId, linkedUser.id);

      // TODO: ROK-138 — If game requires character, trigger character select
      // For now, just confirm the signup
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
   * Show role selection dropdown for anonymous participants (Path B with roles).
   */
  private async showRoleSelect(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.ROLE_SELECT}:${eventId}`)
      .setPlaceholder('Select your role')
      .addOptions([
        { label: 'Tank', value: 'tank', emoji: '🛡️' },
        { label: 'Healer', value: 'healer', emoji: '💚' },
        { label: 'DPS', value: 'dps', emoji: '⚔️' },
      ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    await interaction.editReply({
      content: 'Select your role:',
      components: [row],
    });
  }

  /**
   * Handle select menu interactions (role selection for anonymous signup).
   */
  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(':');
    if (parts.length !== 2 || parts[0] !== SIGNUP_BUTTON_IDS.ROLE_SELECT) {
      return;
    }

    const eventId = parseInt(parts[1], 10);
    if (isNaN(eventId)) return;

    await interaction.deferUpdate();

    const selectedRole = interaction.values[0] as 'tank' | 'healer' | 'dps';

    try {
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
