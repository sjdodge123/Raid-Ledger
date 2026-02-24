import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityType, Events, type Presence } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';

/**
 * ActivityListener — listens for Discord `presenceUpdate` events and
 * delegates game session tracking to GameActivityService (ROK-442).
 *
 * Filters:
 * - Only processes ActivityType.Playing (ignores Streaming, Listening, etc.)
 * - Only tracks users who have linked RL accounts (looked up by Discord ID)
 *
 * Registered on bot connect, unregistered on bot disconnect.
 */
@Injectable()
export class ActivityListener {
  private readonly logger = new Logger(ActivityListener.name);

  /** Cache of Discord user ID -> RL user ID (or null if not linked) */
  private userCache = new Map<string, number | null>();

  /** Bound handler reference for cleanup */
  private boundHandler:
    | ((oldPresence: Presence | null, newPresence: Presence) => void)
    | null = null;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly gameActivityService: GameActivityService,
    private readonly usersService: UsersService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;

    // Remove any existing handler first (handles reconnects)
    if (this.boundHandler) {
      client.removeListener(Events.PresenceUpdate, this.boundHandler);
    }

    this.boundHandler = (
      oldPresence: Presence | null,
      newPresence: Presence,
    ) => {
      this.handlePresenceUpdate(oldPresence, newPresence).catch((err) =>
        this.logger.error(`Presence update handler error: ${err}`),
      );
    };

    client.on(Events.PresenceUpdate, this.boundHandler);
    this.logger.log('Registered presenceUpdate listener for game activity');
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    const client = this.clientService.getClient();
    if (client && this.boundHandler) {
      client.removeListener(Events.PresenceUpdate, this.boundHandler);
    }
    this.boundHandler = null;
    // Clear user cache on disconnect — users may link/unlink while bot is down
    this.userCache.clear();
    this.logger.log('Unregistered presenceUpdate listener');
  }

  private async handlePresenceUpdate(
    oldPresence: Presence | null,
    newPresence: Presence,
  ): Promise<void> {
    const discordUserId = newPresence.userId;

    // Look up RL user ID (cached)
    const userId = await this.resolveUserId(discordUserId);
    if (userId === null) return; // User not linked to RL

    const now = new Date();

    // Extract playing activities from old and new presences
    const oldGames = (oldPresence?.activities ?? [])
      .filter((a) => a.type === ActivityType.Playing)
      .map((a) => a.name);

    const newGames = newPresence.activities
      .filter((a) => a.type === ActivityType.Playing)
      .map((a) => a.name);

    // Detect stopped games (in old but not in new)
    for (const gameName of oldGames) {
      if (!newGames.includes(gameName)) {
        this.gameActivityService.bufferStop(userId, gameName, now);
      }
    }

    // Detect started games (in new but not in old)
    for (const gameName of newGames) {
      if (!oldGames.includes(gameName)) {
        this.gameActivityService.bufferStart(userId, gameName, now);
      }
    }
  }

  /**
   * Resolve a Discord user ID to an RL user ID.
   * Returns null if the user has no linked RL account.
   * Results are cached to avoid repeated DB lookups on high-frequency events.
   */
  private async resolveUserId(discordUserId: string): Promise<number | null> {
    const cached = this.userCache.get(discordUserId);
    if (cached !== undefined) return cached;

    const user = await this.usersService.findByDiscordId(discordUserId);
    const userId = user?.id ?? null;
    this.userCache.set(discordUserId, userId);
    return userId;
  }
}
