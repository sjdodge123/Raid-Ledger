import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelFlags,
  ChannelType,
  PermissionFlagsBits,
  type ForumChannel,
  type Guild,
} from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  FORUM_WEBHOOK_NAME,
  MANAGE_CHANNELS,
  missingForumPermissions,
} from './hub-forum-discord.helpers';
import {
  DEFAULT_REACTION_EMOJI,
  failureOutcome,
  shouldSetDefaultReaction,
} from './hub-forum-discord-decor';

/** A Discord forum as the binding service sees it (no discord.js objects). */
export interface ForumInfo {
  id: string;
  name: string;
  tags: { id: string; name: string }[];
  /** Sync permissions the bot lacks in this channel. */
  missing: string[];
  /** The bot holds Manage Channels here (tag + flag edits). */
  canManage: boolean;
  /** @everyone can view it (MAJOR-4: private forums are never bound). */
  isPublic: boolean;
  /** Discord's Require tags flag is on (a post needs a tag). */
  requireTag: boolean;
}

const REASON = 'Raid Ledger hub forum sync';
const TOPIC = 'Synced with Raid Ledger hub forums.';

/** Best-effort Discord calls never fail the request; they log instead. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2208 §5.1 — every Discord call the binding makes, behind plain data so
 * the service (and its integration spec) never handle discord.js objects.
 */
@Injectable()
export class HubForumDiscordGateway {
  private readonly logger = new Logger(HubForumDiscordGateway.name);

  constructor(private readonly client: DiscordBotClientService) {}

  /** The connected Discord guild's id, or null while the bot is offline. */
  guildId(): string | null {
    return this.client.isConnected()
      ? (this.client.getGuild()?.id ?? null)
      : null;
  }

  /** Every forum channel the bot sees, from the cache. */
  listForums(): ForumInfo[] {
    const guild = this.onlineGuild();
    if (!guild) return [];
    return [...guild.channels.cache.values()]
      .filter((c): c is ForumChannel => c.type === ChannelType.GuildForum)
      .map((f) => toInfo(guild, f))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A forum from the cache (status reads); null when it is gone. */
  cachedForum(channelId: string): ForumInfo | null {
    const guild = this.onlineGuild();
    const ch = guild?.channels.cache.get(channelId);
    if (!guild || ch?.type !== ChannelType.GuildForum) return null;
    return toInfo(guild, ch);
  }

  /** A forum fetched from Discord; null when missing or not a forum. */
  async fetchForum(channelId: string): Promise<ForumInfo | null> {
    const guild = this.onlineGuild();
    const forum = guild ? await fetchForumChannel(guild, channelId) : null;
    return guild && forum ? toInfo(guild, forum) : null;
  }

  /** Permissions the bot lacks guild-wide to create a forum. */
  missingToCreate(): string[] {
    const me = this.onlineGuild()?.members.me ?? null;
    return missingForumPermissions(
      (f) => me?.permissions.has(f) ?? false,
      true,
    );
  }

  /** Create a bot-managed forum named `name` (no REQUIRE_TAG yet). */
  async createForum(name: string): Promise<ForumInfo> {
    const guild = this.requireGuild();
    const forum = await guild.channels.create({
      name,
      type: ChannelType.GuildForum,
      topic: TOPIC,
      reason: REASON,
    });
    return toInfo(guild, forum);
  }

  /** R9: the forum's one webhook — the stored one if live, else a new one. */
  async ensureWebhook(
    channelId: string,
    webhookId: string | null,
  ): Promise<string> {
    const forum = await this.requireForum(channelId);
    const hooks = await forum.fetchWebhooks();
    if (webhookId && hooks.has(webhookId)) return webhookId;
    const hook = await forum.createWebhook({
      name: FORUM_WEBHOOK_NAME,
      reason: REASON,
    });
    return hook.id;
  }

  /**
   * OQ-9: the token is re-fetched, never stored — `GET /channels/:id/webhooks`
   * returns it for incoming webhooks (discord-api-types `APIWebhook.token`).
   */
  async webhookToken(
    channelId: string,
    webhookId: string,
  ): Promise<string | null> {
    const forum = await this.requireForum(channelId);
    const hooks = await forum.fetchWebhooks();
    return hooks.get(webhookId)?.token ?? null;
  }

  /** Add tags by name; returns the forum's full tag list afterwards. */
  async addTags(
    channelId: string,
    names: string[],
  ): Promise<ForumInfo['tags']> {
    let forum = await this.requireForum(channelId);
    if (names.length > 0) {
      const next = [...forum.availableTags, ...names.map((name) => ({ name }))];
      forum = await forum.setAvailableTags(next, REASON);
    }
    return forum.availableTags.map((t) => ({ id: t.id, name: t.name }));
  }

  /** D6: posts must carry a tag once a 2nd hub shares the forum. */
  async requireTags(channelId: string): Promise<void> {
    const forum = await this.requireForum(channelId);
    if (forum.flags.has(ChannelFlags.RequireTag)) return;
    const flags = forum.flags.bitfield | ChannelFlags.RequireTag;
    await forum.edit({ flags, reason: REASON });
  }

  /**
   * ROK-2258 ruling 1 — set the forum's default reaction to 👍 unless a
   * moderator already chose one. Returns true when it was set.
   */
  async setDefaultReactionIfUnset(channelId: string): Promise<boolean> {
    const forum = await this.requireForum(channelId);
    if (!shouldSetDefaultReaction(forum.defaultReactionEmoji)) return false;
    const emoji = { id: null, name: DEFAULT_REACTION_EMOJI };
    await forum.setDefaultReactionEmoji(emoji, REASON);
    return true;
  }

  /**
   * Apply a tag to synced posts (≤5 per post). A post that already carries
   * it costs a read but no write (review r1 MAJOR 2a). A post Discord
   * refuses for good is skipped; a transient error (429/5xx/network) throws
   * so the caller retries (Codex P2 #4).
   */
  async applyTag(
    channelId: string,
    threadIds: string[],
    tagId: string,
  ): Promise<void> {
    const forum = await this.requireForum(channelId);
    for (const id of threadIds) {
      try {
        const thread = await forum.threads.fetch(id);
        if (!thread || thread.appliedTags.includes(tagId)) continue;
        const tags = [...thread.appliedTags, tagId];
        await thread.setAppliedTags(tags.slice(0, 5), REASON);
      } catch (err) {
        if (failureOutcome(err) === 'retry') throw err;
        this.logger.warn(`Could not tag forum post ${id}: ${describe(err)}`);
      }
    }
  }

  /** ROK-2272 §3.4: a channel of any type in the guild already has `name`. */
  channelNameTaken(name: string): boolean {
    const guild = this.onlineGuild();
    if (!guild) return false;
    return guild.channels.cache.some((c) => c.name === name);
  }

  /** ROK-2272 §3.4: rename a forum; Discord errors (e.g. 50013) propagate. */
  async renameForum(channelId: string, name: string): Promise<ForumInfo> {
    const guild = this.requireGuild();
    const forum = await this.requireForum(channelId);
    const renamed = await forum.edit({ name, reason: REASON });
    return toInfo(guild, renamed);
  }

  /** Delete a bot-made forum on unlink. Best-effort. */
  async deleteForum(channelId: string): Promise<void> {
    try {
      const forum = await this.requireForum(channelId);
      await forum.delete(REASON);
    } catch (err) {
      this.logger.warn(`Could not delete forum ${channelId}: ${describe(err)}`);
    }
  }

  private onlineGuild(): Guild | null {
    return this.client.isConnected() ? this.client.getGuild() : null;
  }

  private requireGuild(): Guild {
    const guild = this.onlineGuild();
    if (!guild) throw new Error('Discord bot is offline');
    return guild;
  }

  private async requireForum(channelId: string): Promise<ForumChannel> {
    const forum = await fetchForumChannel(this.requireGuild(), channelId);
    if (!forum) throw new Error(`Forum ${channelId} is gone`);
    return forum;
  }
}

async function fetchForumChannel(
  guild: Guild,
  channelId: string,
): Promise<ForumChannel | null> {
  const ch = await guild.channels.fetch(channelId).catch(goneOrThrow);
  return ch?.type === ChannelType.GuildForum ? ch : null;
}

/**
 * Codex P2 #5 — a channel Discord says is gone or hidden (10003/50001/50013)
 * reads as null; a transient failure (429/5xx/network) rethrows, so a
 * caller never mistakes a blip for a deleted forum.
 */
function goneOrThrow(err: unknown): null {
  if (failureOutcome(err) === 'retry') throw err;
  return null;
}

function toInfo(guild: Guild, forum: ForumChannel): ForumInfo {
  const me = guild.members.me;
  const perms = me ? forum.permissionsFor(me) : null;
  return {
    id: forum.id,
    name: forum.name,
    tags: forum.availableTags.map((t) => ({ id: t.id, name: t.name })),
    missing: missingForumPermissions((f) => perms?.has(f) ?? false, false),
    canManage: perms?.has(MANAGE_CHANNELS.flag) ?? false,
    requireTag: forum.flags.has(ChannelFlags.RequireTag),
    isPublic: forum
      .permissionsFor(guild.roles.everyone)
      .has(PermissionFlagsBits.ViewChannel),
  };
}
