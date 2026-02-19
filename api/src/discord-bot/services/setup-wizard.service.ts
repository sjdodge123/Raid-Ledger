import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS, EMBED_COLORS } from '../discord-bot.constants';

/** Custom IDs for setup wizard interactions */
const SETUP_IDS = {
  START: 'setup_wizard_start',
  SKIP: 'setup_wizard_skip',
  CHANNEL_SELECT: 'setup_wizard_channel',
  NAME_CONFIRM: 'setup_wizard_name_confirm',
  NAME_EDIT: 'setup_wizard_name_edit',
} as const;

@Injectable()
export class SetupWizardService {
  private readonly logger = new Logger(SetupWizardService.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  /** Tracks in-progress wizard state per DM user */
  private wizardState = new Map<
    string,
    { channelId?: string; communityName?: string }
  >();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * On bot connect, check if setup wizard should be sent.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    this.registerInteractionHandler();

    const setupCompleted =
      await this.settingsService.isDiscordBotSetupCompleted();
    if (!setupCompleted) {
      await this.sendSetupWizardToAdmin();
    }
  }

  /**
   * Reset interaction handler state on disconnect.
   */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.boundHandler = null;
  }

  /**
   * Register the interaction handler for setup wizard buttons.
   */
  private registerInteractionHandler(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (
          id === SETUP_IDS.START ||
          id === SETUP_IDS.SKIP ||
          id === SETUP_IDS.NAME_CONFIRM ||
          id === SETUP_IDS.NAME_EDIT
        ) {
          void this.handleButtonInteraction(interaction);
        }
      } else if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === SETUP_IDS.CHANNEL_SELECT) {
          void this.handleChannelSelect(interaction);
        }
      }
    };

    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Setup wizard interaction handler registered');
  }

  /**
   * Send the setup wizard DM to the Raid Ledger admin user.
   * Finds the admin via the users table (role = 'admin' with discordId).
   */
  async sendSetupWizardToAdmin(): Promise<void> {
    if (!this.clientService.isConnected()) {
      this.logger.warn('Cannot send setup wizard DM: bot is not connected');
      return;
    }

    try {
      // Find the RL admin user with a Discord account linked
      const adminUser = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.role, 'admin'))
        .limit(1);

      if (adminUser.length === 0 || !adminUser[0].discordId) {
        this.logger.warn(
          'No admin user with Discord ID found. ' +
            'Setup wizard will be available via the web admin panel.',
        );
        return;
      }

      const discordId = adminUser[0].discordId;

      // Don't send DM to unlinked accounts
      if (discordId.startsWith('unlinked:') || discordId.startsWith('local:')) {
        this.logger.warn(
          'Admin user does not have a linked Discord account. ' +
            'Setup wizard available via web admin panel.',
        );
        return;
      }

      const guildInfo = this.clientService.getGuildInfo();
      const serverName = guildInfo?.name ?? 'your server';

      // Get community name default from branding
      const branding = await this.settingsService.getBranding();
      const defaultName = branding.communityName || guildInfo?.name || '';

      // Store default state
      this.wizardState.set(discordId, { communityName: defaultName });

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SYSTEM)
        .setTitle(`Raid-Ledger is connected to ${serverName}!`)
        .setDescription(
          [
            "Let's finish setting up your bot:",
            '',
            '1. Pick a default announcement channel',
            '2. Confirm your community name',
          ].join('\n'),
        )
        .setFooter({ text: 'Raid Ledger Setup' })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_IDS.START)
          .setLabel('Set Up Now')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('1f527'),
        new ButtonBuilder()
          .setCustomId(SETUP_IDS.SKIP)
          .setLabel("I'll do this later")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('23ed'),
      );

      await this.clientService.sendEmbedDM(discordId, embed, row);
      this.logger.log(
        `Setup wizard DM sent to admin (Discord ID: ${discordId})`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to send setup wizard DM to admin. ' +
          'The wizard is available via the web admin panel.',
        error,
      );
    }
  }

  /**
   * Handle button interactions for the setup wizard.
   */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    try {
      switch (interaction.customId) {
        case SETUP_IDS.START:
          await this.handleStartSetup(interaction);
          break;
        case SETUP_IDS.SKIP:
          await this.handleSkipSetup(interaction);
          break;
        case SETUP_IDS.NAME_CONFIRM:
          await this.handleNameConfirm(interaction);
          break;
        case SETUP_IDS.NAME_EDIT:
          await this.handleNameEdit(interaction);
          break;
      }
    } catch (error) {
      this.logger.error('Error handling setup wizard interaction:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              'Something went wrong. Please try again or use the web admin panel.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Skip setup: leave setupCompleted as false so wizard re-runs on next startup.
   */
  private async handleSkipSetup(interaction: ButtonInteraction): Promise<void> {
    await interaction.reply({
      content:
        'No problem! You can complete setup later from the web admin panel ' +
        'under **Discord Bot** settings, or the wizard will re-appear next time the bot connects.',
      ephemeral: true,
    });
  }

  /**
   * Step 1: Show channel select dropdown.
   */
  private async handleStartSetup(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(SETUP_IDS.CHANNEL_SELECT)
      .setPlaceholder('Select a default announcement channel')
      .setChannelTypes(ChannelType.GuildText);

    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      channelSelect,
    );

    await interaction.reply({
      content:
        '**Step 1/2:** Pick a default announcement channel for event embeds.',
      components: [row],
      ephemeral: true,
    });
  }

  /**
   * Step 2: Channel selected, now confirm community name.
   */
  private async handleChannelSelect(
    interaction: ChannelSelectMenuInteraction,
  ): Promise<void> {
    const selectedChannelId = interaction.values[0];
    const userId = interaction.user.id;

    // Store channel selection in wizard state
    const state = this.wizardState.get(userId) ?? {};
    state.channelId = selectedChannelId;
    this.wizardState.set(userId, state);

    // Get the community name default
    const communityName = state.communityName || 'My Community';

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SETUP_IDS.NAME_CONFIRM)
        .setLabel('Looks Good')
        .setStyle(ButtonStyle.Success)
        .setEmoji('2705'),
      new ButtonBuilder()
        .setCustomId(SETUP_IDS.NAME_EDIT)
        .setLabel('Edit')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('270f'),
    );

    await interaction.update({
      content: `**Step 2/2:** Confirm community name: **${communityName}**`,
      components: [row],
    });
  }

  /**
   * Name confirmed: save all settings and post welcome message.
   */
  private async handleNameConfirm(
    interaction: ButtonInteraction,
  ): Promise<void> {
    await interaction.deferUpdate();

    const userId = interaction.user.id;
    const state = this.wizardState.get(userId);

    if (!state?.channelId) {
      await interaction.editReply({
        content: 'Setup expired. Please try again from the web admin panel.',
        components: [],
      });
      return;
    }

    const communityName = state.communityName || 'My Community';

    // Detect timezone from guild (default to UTC)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    // Save settings
    await this.settingsService.setDiscordBotDefaultChannel(state.channelId);
    await this.settingsService.setDiscordBotCommunityName(communityName);
    await this.settingsService.setDiscordBotTimezone(timezone);
    await this.settingsService.markDiscordBotSetupCompleted();

    // Also update branding community name if not already set
    const branding = await this.settingsService.getBranding();
    if (!branding.communityName) {
      await this.settingsService.setCommunityName(communityName);
    }

    // Post welcome message to the chosen channel
    await this.postWelcomeMessage(state.channelId, communityName);

    // Get channel name for confirmation
    const channels = this.clientService.getTextChannels();
    const channel = channels.find((ch) => ch.id === state.channelId);
    const channelDisplay = channel
      ? `#${channel.name}`
      : 'the selected channel';

    await interaction.editReply({
      content: `Setup complete! Welcome message posted to ${channelDisplay}.`,
      components: [],
    });

    // Cleanup wizard state
    this.wizardState.delete(userId);
    this.logger.log('Discord bot setup wizard completed successfully');
  }

  /**
   * Name edit: prompt for new name via a modal-like follow-up.
   * Discord DMs don't support modals cleanly, so we prompt for a text reply.
   */
  private async handleNameEdit(interaction: ButtonInteraction): Promise<void> {
    const userId = interaction.user.id;
    const state = this.wizardState.get(userId);

    await interaction.reply({
      content:
        'Please type your community name below (just send a message in this DM).\n' +
        'Then click **Looks Good** when the updated name appears.',
      ephemeral: true,
    });

    // Listen for the next message from this user in DMs
    const client = this.clientService.getClient();
    if (!client) return;

    const filter = (msg: import('discord.js').Message) =>
      msg.author.id === userId && msg.channel.isDMBased();

    try {
      const dmChannel = await client.users
        .fetch(userId)
        .then((u) => u.createDM());
      const collected = await dmChannel.awaitMessages({
        filter,
        max: 1,
        time: 60_000,
      });

      const newName = collected.first()?.content?.trim();
      if (!newName) {
        await dmChannel.send(
          'No name received. Using the previous name. Click **Looks Good** to continue.',
        );
        return;
      }

      // Update wizard state
      if (state) {
        state.communityName = newName;
        this.wizardState.set(userId, state);
      }

      // Show updated confirmation
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_IDS.NAME_CONFIRM)
          .setLabel('Looks Good')
          .setStyle(ButtonStyle.Success)
          .setEmoji('2705'),
        new ButtonBuilder()
          .setCustomId(SETUP_IDS.NAME_EDIT)
          .setLabel('Edit')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('270f'),
      );

      await dmChannel.send({
        content: `**Step 2/2:** Confirm community name: **${newName}**`,
        components: [row],
      });
    } catch {
      this.logger.debug('Name edit timed out or failed for setup wizard');
    }
  }

  /**
   * Post the public welcome message to the chosen channel.
   */
  private async postWelcomeMessage(
    channelId: string,
    communityName: string,
  ): Promise<void> {
    try {
      const clientUrl = process.env.CLIENT_URL ?? null;

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.ANNOUNCEMENT)
        .setTitle('Raid-Ledger is live!')
        .setDescription(
          [
            'Event announcements will appear here. Sign up, check rosters,',
            'and get reminders -- all without leaving Discord.',
          ].join('\n'),
        )
        .setFooter({
          text: `View in Raid Ledger \u2022 ${communityName}`,
        })
        .setTimestamp();

      // Add link button if client URL is available
      if (clientUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Open Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(clientUrl),
        );
        await this.clientService.sendEmbed(channelId, embed, row);
      } else {
        await this.clientService.sendEmbed(channelId, embed);
      }

      this.logger.log(`Welcome message posted to channel ${channelId}`);
    } catch (error) {
      this.logger.error(
        `Failed to post welcome message to channel ${channelId}:`,
        error,
      );
    }
  }
}
