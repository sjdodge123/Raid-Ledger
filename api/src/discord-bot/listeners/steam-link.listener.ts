/**
 * Listener that detects Steam store URLs in Discord messages and prompts
 * users to mark interest in the game on Raid Ledger (ROK-966).
 *
 * Three prompt options:
 * 1. "Interested" -- create game_interests row with source 'discord'
 * 2. "Not Interested" -- dismiss the ephemeral prompt
 * 3. "Always Auto-Interest" -- heart + set autoHeartSteamUrls preference
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
  type ButtonInteraction,
  type Interaction,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ItadService } from '../../itad/itad.service';
import { IgdbService } from '../../igdb/igdb.service';
import { SettingsService } from '../../settings/settings.service';
import { SETTING_KEYS } from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DISCORD_BOT_EVENTS,
  STEAM_INTEREST_BUTTON_IDS,
} from '../discord-bot.constants';
import { parseSteamAppIds } from './steam-link.helpers';
import {
  findGameBySteamAppId,
  findLinkedRlUser,
  hasExistingHeartInterest,
  getAutoHeartSteamUrlsPref,
  addDiscordInterest,
  setAutoHeartSteamUrlsPref,
  discoverGameBySteamAppId,
} from './steam-link-interest.helpers';

/** Dedup TTL in milliseconds. */
const DEDUP_TTL_MS = 30_000;

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Detects Steam store URLs in Discord messages and prompts
 * the user to heart the game on Raid Ledger.
 */
@Injectable()
export class SteamLinkListener {
  private readonly logger = new Logger(SteamLinkListener.name);
  private listenerAttached = false;
  private readonly recentlyProcessed = new Map<string, number>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: Db,
    private readonly clientService: DiscordBotClientService,
    @Optional() private readonly itadService: ItadService,
    @Optional() private readonly igdbService: IgdbService,
    private readonly settingsService: SettingsService,
  ) {
    this.startDedupCleanup();
  }

  /** Periodically clean up expired dedup entries. */
  private startDedupCleanup(): void {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, ts] of this.recentlyProcessed) {
        if (now - ts > DEDUP_TTL_MS) this.recentlyProcessed.delete(id);
      }
    }, DEDUP_TTL_MS);
    timer.unref();
  }

  /** Attach message + interaction listeners when the Discord bot connects. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client || this.listenerAttached) return;

    client.on(Events.MessageCreate, (message: Message) => {
      this.handleMessage(message).catch((err: unknown) => {
        this.logger.error('Steam link listener error:', err);
      });
    });

    client.on('interactionCreate', (interaction: Interaction) => {
      if (interaction.isButton()) {
        this.handleButtonInteraction(interaction).catch((err: unknown) => {
          this.logger.error('Steam interest button error:', err);
        });
      }
    });

    this.listenerAttached = true;
    this.logger.log('Steam link interest listener attached');
  }

  /** Reset listener state on disconnect so it can re-attach. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.listenerAttached = false;
  }

  /** Process a messageCreate event for Steam URLs. */
  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (this.recentlyProcessed.has(message.id)) return;
    this.recentlyProcessed.set(message.id, Date.now());
    if (!message.guild) return;
    if (!isGuildTextChannel(message.channel.type)) return;

    const appIds = parseSteamAppIds(message.content);
    if (appIds.length === 0) return;

    await this.processAppIds(appIds, message);
  }

  /** Process extracted app IDs: resolve, check, and prompt or auto-heart. */
  private async processAppIds(
    appIds: number[],
    message: Message,
  ): Promise<void> {
    for (const appId of appIds) {
      await this.processSingleAppId(appId, message);
    }
  }

  /** Handle a single Steam app ID from a message. */
  private async processSingleAppId(
    appId: number,
    message: Message,
  ): Promise<void> {
    let game = await findGameBySteamAppId(this.db, appId);
    if (!game) {
      game = await this.discoverGame(appId);
      if (!game) return;
    }

    if (!game.igdbId && this.igdbService) {
      this.igdbService.enqueueReenrich(game.id).catch((err: unknown) => {
        this.logger.warn(`Failed to enqueue re-enrichment: ${String(err)}`);
      });
    }

    const user = await findLinkedRlUser(this.db, message.author.id);
    if (!user) return;

    await this.dispatchInterestFlow(message, user.id, game);
  }

  /**
   * Dispatch the post-lookup interest flow: already-hearted DM, auto-heart
   * DM, or interactive prompt depending on existing state and preferences.
   */
  private async dispatchInterestFlow(
    message: Message,
    userId: number,
    game: { id: number; name: string },
  ): Promise<void> {
    const alreadyInterested = await hasExistingHeartInterest(
      this.db,
      userId,
      game.id,
    );
    if (alreadyInterested) {
      await this.sendDmSafe(
        message,
        `You already have **${game.name}** hearted! 💜`,
      );
      return;
    }

    const autoHeart = await getAutoHeartSteamUrlsPref(this.db, userId);
    if (autoHeart) {
      await addDiscordInterest(this.db, userId, game.id);
      await this.sendDmSafe(message, `Auto-hearted **${game.name}**! 💜`);
      return;
    }

    await this.sendInterestPrompt(message, game);
  }

  /**
   * Send a plain-text DM to the message author, swallowing and logging
   * failures (e.g. when the user has DMs disabled from server members).
   */
  private async sendDmSafe(message: Message, content: string): Promise<void> {
    try {
      const dm = await message.author.createDM();
      await dm.send({ content });
    } catch (err: unknown) {
      this.logger.warn(`Failed to send Steam interest DM: ${String(err)}`);
    }
  }

  /** Discover and add a game via ITAD when it's not in the DB. */
  private async discoverGame(
    appId: number,
  ): Promise<{ id: number; name: string; igdbId: number | null } | null> {
    if (!this.itadService) return null;
    const adultFilter =
      (await this.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT)) ===
      'true';
    return discoverGameBySteamAppId(
      {
        db: this.db,
        lookupBySteamAppId: (id) => this.itadService.lookupBySteamAppId(id),
        adultFilterEnabled: adultFilter,
      },
      appId,
    );
  }

  /** Send the interest prompt as a DM to the message author. */
  private async sendInterestPrompt(
    message: Message,
    game: { id: number; name: string },
  ): Promise<void> {
    const row = buildButtonRow(game.id);
    const dm = await message.author.createDM();
    await dm.send({
      content: `Interested in **${game.name}** on Raid Ledger?`,
      components: [row],
    });
  }

  /** Handle a button interaction from the interest prompt. */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parsed = parseSteamButtonId(interaction.customId);
    if (!parsed) return;

    const { action, gameId } = parsed;
    const user = await findLinkedRlUser(this.db, interaction.user.id);

    if (action === STEAM_INTEREST_BUTTON_IDS.DISMISS) {
      await this.handleDismissButton(interaction);
      return;
    }

    if (!user) {
      await interaction.update({
        content: 'Could not find your linked account.',
        components: [],
      });
      return;
    }

    if (action === STEAM_INTEREST_BUTTON_IDS.HEART) {
      await this.handleHeartButton(interaction, user.id, gameId);
    } else if (action === STEAM_INTEREST_BUTTON_IDS.AUTO) {
      await this.handleAutoButton(interaction, user.id, gameId);
    }
  }

  /** Handle the "Interested" button click. */
  private async handleHeartButton(
    interaction: ButtonInteraction,
    userId: number,
    gameId: number,
  ): Promise<void> {
    await addDiscordInterest(this.db, userId, gameId);
    await interaction.update({
      content: 'Marked as interested!',
      components: [],
    });
  }

  /** Handle the "Not Interested" button click. */
  private async handleDismissButton(
    interaction: ButtonInteraction,
  ): Promise<void> {
    await interaction.update({ content: 'Dismissed.', components: [] });
  }

  /** Handle the "Always Auto-Interest" button click. */
  private async handleAutoButton(
    interaction: ButtonInteraction,
    userId: number,
    gameId: number,
  ): Promise<void> {
    await addDiscordInterest(this.db, userId, gameId);
    await setAutoHeartSteamUrlsPref(this.db, userId, true);
    await interaction.update({
      content: 'Auto-interest enabled for future Steam URLs!',
      components: [],
    });
  }
}

// --- Pure helpers ---

/** Check if a channel type is a guild text channel. */
function isGuildTextChannel(type: ChannelType): boolean {
  return (
    type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement
  );
}

/** Build the action row with 3 buttons for the interest prompt. */
function buildButtonRow(gameId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.HEART}:${gameId}`)
      .setLabel('Interested')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.DISMISS}:${gameId}`)
      .setLabel('Not Interested')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.AUTO}:${gameId}`)
      .setLabel('Always Auto-Interest')
      .setStyle(ButtonStyle.Primary),
  );
}

/** Parse a steam interest button custom ID into action + gameId. */
function parseSteamButtonId(
  customId: string,
): { action: string; gameId: number } | null {
  const parts = customId.split(':');
  if (parts.length !== 2) return null;
  const [action, gameIdStr] = parts;
  const gameId = parseInt(gameIdStr, 10);
  if (isNaN(gameId)) return null;
  const validActions = [
    STEAM_INTEREST_BUTTON_IDS.HEART,
    STEAM_INTEREST_BUTTON_IDS.DISMISS,
    STEAM_INTEREST_BUTTON_IDS.AUTO,
  ];
  if (!validActions.includes(action as (typeof validActions)[number])) {
    return null;
  }
  return { action, gameId };
}
