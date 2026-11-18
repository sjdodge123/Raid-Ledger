import { Inject, Injectable } from '@nestjs/common';
import {
  HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME as SHARED_NAME,
  type HubForumDiscordChannelOptions,
  type HubForumDiscordHealth,
  type HubForumDiscordPreflight,
  type HubForumDiscordStatus,
  type PutHubForumDiscordInput,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { isUniqueViolation } from '../../../events/signups-roster-slot.helpers';
import type { GuildActor } from '../../guild-access.service';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';
import {
  channelPrivate,
  forumChannelName,
  forumDiscordError,
  parseBindBody,
} from './hub-forum-discord.helpers';
import {
  channelOptions,
  findSharedForum,
  preflight,
  suggestedForumName,
} from './hub-forum-discord.picker';
import { KeyedSerializer } from './hub-forum-discord.bind-lock';
import {
  deleteBinding,
  deleteForumRow,
  findBinding,
  hubName,
  inUseChannelIds,
  insertBinding,
  listForumBindings,
  updateForum,
  upsertForum,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';
import { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import { shareForumTags } from './hub-forum-discord.share';
import { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';

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
  private readonly binds = new KeyedSerializer();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
    private readonly routes: HubForumDiscordRouteResolver,
    private readonly decor: HubForumDiscordDecor,
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

  /** `GET channels` — public forums the hub may bind (see `channelOptions`). */
  async channels(): Promise<HubForumDiscordChannelOptions> {
    return channelOptions(this.db, this.gateway, this.requireOnline());
  }

  /** `GET preflight` — bot online, missing perms, the shared option. */
  preflight(guildId: number): Promise<HubForumDiscordPreflight> {
    return preflight(this.db, this.gateway, guildId);
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
    return this.binds.run(discordGuildId, () =>
      this.bindLocked(actor, guildId, input, discordGuildId),
    );
  }

  /** Codex P2: one bind per Discord guild at a time; rechecks inside. */
  private async bindLocked(
    actor: GuildActor,
    guildId: number,
    input: PutHubForumDiscordInput,
    discordGuildId: string,
  ): Promise<HubForumDiscordStatus> {
    if (await findBinding(this.db, guildId)) throw alreadyBound();
    const { info, managed } = await this.target(discordGuildId, guildId, input);
    const forum = await upsertForum(this.db, {
      discordGuildId,
      channelId: info.id,
      managed,
    });
    const tagId = await shareForumTags(this.db, this.gateway, {
      guildId,
      forum,
      info,
    });
    await this.ensureWebhook(forum, info.id);
    await this.insert(actor, guildId, forum.id, tagId);
    this.routes.invalidate(); // §5.4: inbound routing sees the new hub now
    // ROK-2258: tags + 👍, best-effort. Awaited under the bind lock (a 2nd
    // bind must not rewrite the tag list mid-run); bounded to the joining
    // hub's event posts, and already-tagged posts cost no write.
    await this.decor.run(forum.id, info.id, guildId);
    return this.status(guildId);
  }

  /** `DELETE` — unlink; a bot-made forum goes only if asked AND unshared. */
  async unbind(guildId: number, deleteForum: boolean): Promise<void> {
    const row = await findBinding(this.db, guildId);
    if (!row) return;
    await deleteBinding(this.db, guildId);
    this.routes.invalidate(); // D9: an unbound hub stops syncing now
    if (!deleteForum || !row.forum.managed) return;
    // Review M1: under the bind lock, so a bind that just picked this forum
    // lands (and keeps it) before the "nobody uses it" check runs.
    const { discordGuildId, id, channelId } = row.forum;
    await this.binds.run(discordGuildId, async () => {
      if ((await listForumBindings(this.db, id)).length > 0) return;
      if (this.gateway.guildId() === null) return;
      await this.gateway.deleteForum(channelId);
      await deleteForumRow(this.db, id);
    });
  }

  /** R9: one webhook per forum; store its id (OQ-9: never the token). */
  private async ensureWebhook(
    forum: { id: number; webhookId: string | null },
    channelId: string,
  ): Promise<void> {
    const webhookId = await this.gateway.ensureWebhook(
      channelId,
      forum.webhookId,
    );
    if (webhookId !== forum.webhookId)
      await updateForum(this.db, forum.id, { webhookId });
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

  /**
   * Q10(c) — the forum to bind: `existing` as picked; `create` + `shared`
   * joins the one `#hub-forums` (made only when none exists); `create` +
   * `own` makes a forum named from the request or the hub.
   */
  private async target(
    discordGuildId: string,
    guildId: number,
    input: PutHubForumDiscordInput,
  ): Promise<{ info: ForumInfo; managed: boolean }> {
    if (input.mode === 'existing') {
      const id = input.channelId ?? '';
      return {
        info: await this.existingForum(discordGuildId, id),
        managed: false,
      };
    }
    if (input.target === 'shared') {
      const found = await findSharedForum(
        this.db,
        this.gateway,
        discordGuildId,
      );
      if (found) {
        const info = await this.existingForum(discordGuildId, found.id);
        return { info, managed: false };
      }
      return { info: await this.createForum(SHARED_NAME), managed: true };
    }
    const name =
      input.name !== undefined
        ? forumChannelName(input.name)
        : suggestedForumName((await hubName(this.db, guildId)) ?? 'Hub');
    return { info: await this.createForum(name), managed: true };
  }

  private async createForum(name: string): Promise<ForumInfo> {
    const missing = this.gateway.missingToCreate();
    if (missing.length > 0) throw missingPerms(missing);
    return this.gateway.createForum(name);
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
    if (!info.isPublic) throw channelPrivate();
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
