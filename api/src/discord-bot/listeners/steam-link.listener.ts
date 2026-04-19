/**
 * Listener that detects Steam store URLs in Discord messages and prompts
 * users to heart the game (ROK-966) or nominate it to the current
 * Community Lineup (ROK-1081).
 *
 * Heart flow (no building lineup) — 3 buttons:
 *   Interested / Not Interested / Always Auto-Interest
 *
 * Nomination flow (building lineup active) — 4 buttons:
 *   Nominate / Just Heart It / Always Auto-Nominate / Dismiss
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  ChannelType,
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
import { LineupsService } from '../../lineups/lineups.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { parseSteamAppIds } from './steam-link.helpers';
import {
  findGameBySteamAppId,
  findLinkedRlUser,
  hasExistingHeartInterest,
  getAutoHeartSteamUrlsPref,
  addDiscordInterest,
  setAutoNominateSteamUrlsPref,
  discoverGameBySteamAppId,
  findActiveBuildingLineup,
  isGameNominated,
  getAutoNominateSteamUrlsPref,
} from './steam-link-interest.helpers';
import {
  buildInterestButtonRow,
  handleInterestButtonClick,
} from './steam-link.listener.interest-flow';
import {
  buildNominationPrompt,
  handleNominateButtonClick,
  parseSteamNominateButtonId,
  safeNominate,
} from './steam-link.listener.nomination-flow';

/** Dedup TTL in milliseconds. */
const DEDUP_TTL_MS = 30_000;

type Db = PostgresJsDatabase<typeof schema>;
type Game = { id: number; name: string; igdbId: number | null };

/**
 * Detects Steam store URLs in Discord messages and prompts
 * the user to heart or nominate the game on Raid Ledger.
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
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    this.startDedupCleanup();
  }

  /**
   * Lazily resolve LineupsService via ModuleRef to avoid an import-time
   * cycle between DiscordBotModule <-> LineupsModule. Returns null when
   * the service isn't registered (e.g. in isolated unit tests without
   * the full module graph).
   */
  private getLineupsService(): LineupsService | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(LineupsService, { strict: false });
    } catch {
      return null;
    }
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

    const buildingLineup = await findActiveBuildingLineup(this.db);
    if (buildingLineup) {
      await this.dispatchNominationFlow(
        message,
        user.id,
        game,
        buildingLineup.id,
      );
    } else {
      await this.dispatchInterestFlow(message, user.id, game);
    }
  }

  /** Heart flow (ROK-966) — 3-button prompt when no building lineup exists. */
  private async dispatchInterestFlow(
    message: Message,
    userId: number,
    game: Game,
  ): Promise<void> {
    if (await hasExistingHeartInterest(this.db, userId, game.id)) {
      await this.sendDmSafe(
        message,
        `You already have **${game.name}** hearted! 💜`,
      );
      return;
    }
    if (await getAutoHeartSteamUrlsPref(this.db, userId)) {
      await addDiscordInterest(this.db, userId, game.id);
      await this.sendDmSafe(message, `Auto-hearted **${game.name}**! 💜`);
      return;
    }
    const row = buildInterestButtonRow(game.id);
    const dm = await message.author.createDM();
    await dm.send({
      content: `Interested in **${game.name}** on Raid Ledger?`,
      components: [row],
    });
  }

  /** Nomination flow (ROK-1081) — 4-button prompt when a building lineup is active. */
  private async dispatchNominationFlow(
    message: Message,
    userId: number,
    game: Game,
    lineupId: number,
  ): Promise<void> {
    if (await isGameNominated(this.db, lineupId, game.id)) {
      await this.sendDmSafe(
        message,
        `**${game.name}** is already nominated for the current lineup.`,
      );
      return;
    }
    if (await getAutoNominateSteamUrlsPref(this.db, userId)) {
      await this.autoNominate(message, userId, game, lineupId);
      return;
    }
    const dm = await message.author.createDM();
    await dm.send(buildNominationPrompt(game));
  }

  /** Auto-nominate path: call LineupsService and DM the result. */
  private async autoNominate(
    message: Message,
    userId: number,
    game: Game,
    lineupId: number,
  ): Promise<void> {
    const lineups = this.getLineupsService();
    if (!lineups) {
      await this.sendDmSafe(message, 'Auto-nominate is not available.');
      return;
    }
    const copy = await safeNominate(
      lineups,
      lineupId,
      game.id,
      game.name,
      userId,
      `Auto-nominated **${game.name}** to the current lineup!`,
    );
    await this.sendDmSafe(message, copy);
  }

  /** Send a plain-text DM, swallowing and logging failures. */
  private async sendDmSafe(message: Message, content: string): Promise<void> {
    try {
      const dm = await message.author.createDM();
      await dm.send({ content });
    } catch (err: unknown) {
      const detail =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.warn(`Failed to send Steam interest DM: ${detail}`);
    }
  }

  /** Discover and add a game via ITAD when it's not in the DB. */
  private async discoverGame(appId: number): Promise<Game | null> {
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

  /** Route button interactions to the heart or nominate handler. */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const nom = parseSteamNominateButtonId(interaction.customId);
    if (nom) {
      await handleNominateButtonClick(
        this.buildNominateDeps(),
        interaction,
        nom.action,
        nom.gameId,
      );
      return;
    }
    await handleInterestButtonClick(this.db, interaction);
  }

  /** Build the deps object for the nomination button click handler. */
  private buildNominateDeps() {
    return {
      db: this.db,
      lineupsService: this.getLineupsService() ?? undefined,
      findActiveBuildingLineupId: async () =>
        (await findActiveBuildingLineup(this.db))?.id ?? null,
      addInterest: (userId: number, gameId: number) =>
        addDiscordInterest(this.db, userId, gameId),
      findLinkedUser: (discordId: string) =>
        findLinkedRlUser(this.db, discordId),
      setAutoNominatePref: (userId: number, enabled: boolean) =>
        setAutoNominateSteamUrlsPref(this.db, userId, enabled),
    };
  }
}

/** Check if a channel type is a guild text channel. */
function isGuildTextChannel(type: ChannelType): boolean {
  return (
    type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement
  );
}
