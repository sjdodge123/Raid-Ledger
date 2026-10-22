import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';

/** A minted invite lives 24h on Discord; reuse it a little less than that. */
const INVITE_MAX_AGE_S = 86_400;
const CACHE_TTL_MS = 23 * 3_600_000;

interface CachedInvite {
  url: string | null;
  until: number;
}

/**
 * ROK-1893 P1 (§8d) — a bot-made Discord server invite for the hub-invite
 * preview, so a visitor outside the server can get in first. Prefers the
 * hub's own channel (`guild_profiles.discord_channel_id`), else the server's
 * system channel. Needs the bot's Create Invite permission; null whenever the
 * bot cannot make one. Cached per hub (a failure is cached too, briefly).
 */
@Injectable()
export class HubDiscordInviteService {
  private readonly logger = new Logger(HubDiscordInviteService.name);
  private readonly cache = new Map<number, CachedInvite>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly client: DiscordBotClientService,
  ) {}

  /** The hub's cached server invite URL, minting one when needed. */
  async serverInviteUrl(hubId: number): Promise<string | null> {
    const hit = this.cache.get(hubId);
    if (hit && hit.until > Date.now()) return hit.url;
    const url = await this.mint(hubId);
    const ttl = url === null ? 5 * 60_000 : CACHE_TTL_MS;
    this.cache.set(hubId, { url, until: Date.now() + ttl });
    return url;
  }

  private async mint(hubId: number): Promise<string | null> {
    const guild = this.client.getGuild();
    if (!guild) return null;
    try {
      const channelId =
        (await this.hubChannelId(hubId)) ?? guild.systemChannelId;
      if (!channelId) return null;
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !('createInvite' in channel)) return null;
      const invite = await channel.createInvite({
        maxAge: INVITE_MAX_AGE_S,
        unique: false,
        reason: `Hub invite preview for hub ${hubId}`,
      });
      return invite.url;
    } catch (err) {
      // Missing Create Invite permission / unknown channel: text-only fallback.
      this.logger.warn(
        `hub ${hubId}: could not create a Discord invite (${err instanceof Error ? err.message : String(err)})`,
      );
      return null;
    }
  }

  private async hubChannelId(hubId: number): Promise<string | null> {
    const p = schema.guildProfiles;
    const [row] = await this.db
      .select({ channelId: p.discordChannelId })
      .from(p)
      .where(eq(p.guildId, hubId))
      .limit(1);
    return row?.channelId ?? null;
  }
}
