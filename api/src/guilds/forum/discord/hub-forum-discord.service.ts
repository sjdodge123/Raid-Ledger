import { Inject, Injectable } from '@nestjs/common';
import type {
  HubForumDiscordChannelOptions,
  HubForumDiscordHealth,
  HubForumDiscordStatus,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { isUniqueViolation } from '../../../events/signups-roster-slot.helpers';
import type { GuildActor } from '../../guild-access.service';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';
import {
  forumDiscordError,
  parseBindBody,
  tagsFree,
} from './hub-forum-discord.helpers';
import {
  bindingCountsByChannel,
  deleteBinding,
  deleteForumRow,
  findBinding,
  inUseChannelIds,
  insertBinding,
  listForumBindings,
  updateForum,
  upsertForum,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';
import { shareForumTags } from './hub-forum-discord.share';

const alreadyBound = () =>
  forumDiscordError(
    409,
    'FORUM_DISCORD_ALREADY_BOUND',
    'This hub is already linked to a Discord forum. Unlink it first.',
  );

function healthOf(
  online: boolean,
  info: ForumInfo | null,
): HubForumDiscordHealth {
  if (!online) return 'bot-offline';
  if (!info) return 'channel-missing';
  return info.missing.length > 0 ? 'missing-perms' : 'ok';
}

/**
 * ROK-2208 §5.1 — bind, unbind and read a hub's Discord forum. Route guards
 * (`GuildLeaderGuard` = `canManageDiscord`) decide who may call which.
 */
@Injectable()
export class HubForumDiscordService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
  ) {}

  /** `GET` — the hub's binding (null while unlinked) and its health. */
  async status(guildId: number): Promise<HubForumDiscordStatus> {
    const row = await findBinding(this.db, guildId);
    if (!row) return { binding: null };
    const hubs = await listForumBindings(this.db, row.forum.id);
    const online = this.gateway.guildId() !== null;
    const info = online ? this.gateway.cachedForum(row.forum.channelId) : null;
    const tagId = row.binding.tagId;
    return {
      binding: {
        channelId: row.forum.channelId,
        channelName: info?.name ?? '',
        managed: row.forum.managed,
        shared: hubs.length > 1,
        sharedWith: Math.max(0, hubs.length - 1),
        tagName: info?.tags.find((t) => t.id === tagId)?.name ?? null,
        boundAt: row.binding.boundAt.toISOString(),
        health: healthOf(online, info),
        missingPermissions: info?.missing ?? [],
      },
    };
  }

  /**
   * `GET channels` — forums the hub may bind. `tagsFree` reserves the first
   * hub's tag on a forum one hub already uses; 0 = shared option unavailable.
   */
  async channels(): Promise<HubForumDiscordChannelOptions> {
    const discordGuildId = this.requireOnline();
    const [inUse, counts] = await Promise.all([
      inUseChannelIds(this.db, discordGuildId),
      bindingCountsByChannel(this.db),
    ]);
    const channels = this.gateway
      .listForums()
      .filter((f) => !inUse.has(f.id))
      .map((f) => {
        const sharedWith = counts.get(f.id) ?? 0;
        const reserved = sharedWith === 1 ? 1 : 0;
        return {
          id: f.id,
          name: f.name,
          sharedWith,
          tagsFree: tagsFree(f.tags.length + reserved),
        };
      });
    return { channels };
  }

  /** `PUT` — bind the hub (create a forum or join an existing one). */
  async bind(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<HubForumDiscordStatus> {
    const input = parseBindBody(body);
    if (await findBinding(this.db, guildId)) throw alreadyBound();
    const discordGuildId = this.requireOnline();
    const info =
      input.mode === 'create'
        ? await this.createForum()
        : await this.existingForum(discordGuildId, input.channelId ?? '');
    const forum = await upsertForum(this.db, {
      discordGuildId,
      channelId: info.id,
      managed: input.mode === 'create',
    });
    const tagId = await shareForumTags(this.db, this.gateway, {
      guildId,
      forum,
      info,
    });
    const webhookId = await this.gateway.ensureWebhook(
      info.id,
      forum.webhookId,
    );
    if (webhookId !== forum.webhookId)
      await updateForum(this.db, forum.id, { webhookId });
    await this.insert(actor, guildId, forum.id, tagId);
    return this.status(guildId);
  }

  /** `DELETE` — unlink; a bot-made forum goes only if asked AND unshared. */
  async unbind(guildId: number, deleteForum: boolean): Promise<void> {
    const row = await findBinding(this.db, guildId);
    if (!row) return;
    await deleteBinding(this.db, guildId);
    if (!deleteForum || !row.forum.managed) return;
    if ((await listForumBindings(this.db, row.forum.id)).length > 0) return;
    if (this.gateway.guildId() === null) return;
    await this.gateway.deleteForum(row.forum.channelId);
    await deleteForumRow(this.db, row.forum.id);
  }

  private async insert(
    actor: GuildActor,
    guildId: number,
    forumId: number,
    tagId: string | null,
  ): Promise<void> {
    const now = new Date();
    try {
      await insertBinding(this.db, {
        guildId,
        forumId,
        tagId,
        ackBy: actor.id,
        ackAt: now,
        boundAt: now,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyBound();
      throw err;
    }
  }

  private requireOnline(): string {
    const id = this.gateway.guildId();
    if (id === null) {
      throw forumDiscordError(
        503,
        'DISCORD_BOT_OFFLINE',
        'The Discord bot is offline.',
      );
    }
    return id;
  }

  private async createForum(): Promise<ForumInfo> {
    const missing = this.gateway.missingToCreate();
    if (missing.length > 0) throw missingPerms(missing);
    return this.gateway.createForum();
  }

  private async existingForum(
    discordGuildId: string,
    channelId: string,
  ): Promise<ForumInfo> {
    const info = await this.gateway.fetchForum(channelId);
    if (!info) {
      throw forumDiscordError(
        422,
        'FORUM_DISCORD_NOT_A_FORUM',
        'That channel is not a Discord forum the bot can see.',
      );
    }
    if ((await inUseChannelIds(this.db, discordGuildId)).has(info.id)) {
      throw forumDiscordError(
        409,
        'FORUM_DISCORD_CHANNEL_IN_USE',
        'That channel is already the LFG board or a hub mirror/media channel.',
      );
    }
    if (info.missing.length > 0) throw missingPerms(info.missing);
    return info;
  }
}

/** 422 with the permission labels the bot lacks. */
export function missingPerms(missing: string[]) {
  return forumDiscordError(
    422,
    'FORUM_DISCORD_MISSING_PERMS',
    `The bot is missing: ${missing.join(', ')}.`,
    { missing },
  );
}
