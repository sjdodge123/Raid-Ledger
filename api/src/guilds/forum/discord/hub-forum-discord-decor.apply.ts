import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  EVENT_TAG_NAME,
  failureOutcome,
  findTagId,
  planTagCreates,
  shouldRequireTags,
  type DecorOutcome,
  type ForumTag,
} from './hub-forum-discord-decor';
import { linkedEventThreadIds } from './hub-forum-discord-decor.queries';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';
import { tagNameFor } from './hub-forum-discord.helpers';
import {
  linkedThreadIds,
  listForumBindings,
  setBindingTag,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

type BoundHub = Awaited<ReturnType<typeof listForumBindings>>[number];

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2258 — dress a bound Discord forum: a tag per hub (even a lone one),
 * an Event tag on event posts, 👍 as the default reaction when unset, and
 * Require tags once more than one hub shares it. Best-effort: never fails
 * a bind; `run` answers a {@link DecorOutcome} so the deploy backfill retries
 * only transient failures.
 */
@Injectable()
export class HubForumDiscordDecor {
  private readonly logger = new Logger(HubForumDiscordDecor.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
  ) {}

  /**
   * Dress forum `forumId` (Discord channel `channelId`). A bind passes the
   * `joiningGuildId` so only that hub's event posts are tagged (review r1
   * MAJOR 2); the backfill omits it and tags every bound hub's.
   */
  async run(
    forumId: number,
    channelId: string,
    joiningGuildId?: number,
  ): Promise<DecorOutcome> {
    try {
      const info = await this.gateway.fetchForum(channelId);
      if (!info) return this.unreadable(channelId);
      if (!info.canManage) return this.settle(channelId, 'no Manage Channels');
      await this.dress(info, forumId, joiningGuildId);
      return 'done';
    } catch (err) {
      const outcome = failureOutcome(err);
      this.logger.warn(
        `Forum ${channelId} not dressed (${outcome}): ${describe(err)}`,
      );
      return outcome;
    }
  }

  private async dress(
    info: ForumInfo,
    forumId: number,
    joiningGuildId: number | undefined,
  ): Promise<void> {
    const hubs = await listForumBindings(this.db, forumId);
    const tags = await this.ensureTags(info, hubs);
    await this.tagHubs(info.id, hubs, tags);
    const eventHubs =
      joiningGuildId === undefined
        ? hubs.map((h) => h.guildId)
        : [joiningGuildId];
    await this.tagEvents(info.id, eventHubs, tags);
    await this.gateway.setDefaultReactionIfUnset(info.id);
    if (shouldRequireTags(hubs.length, info.requireTag))
      await this.gateway.requireTags(info.id);
  }

  /** Forum unreadable: offline bot → retry; deleted channel → settled. */
  private unreadable(channelId: string): DecorOutcome {
    if (this.gateway.guildId() === null) return 'retry';
    return this.settle(channelId, 'forum not visible');
  }

  private settle(channelId: string, why: string): DecorOutcome {
    this.logger.warn(`Forum ${channelId} not dressed (settled): ${why}`);
    return 'settled';
  }

  /** Create the missing hub + Event tags; log the ones past the cap. */
  private async ensureTags(
    info: ForumInfo,
    hubs: readonly BoundHub[],
  ): Promise<ForumTag[]> {
    const wanted = hubs
      .filter((h) => h.tagId === null)
      .map((h) => tagNameFor(h.hubName));
    const plan = planTagCreates(info.tags, [...wanted, EVENT_TAG_NAME]);
    if (plan.skipped.length > 0)
      this.logger.warn(
        `Forum ${info.id} is at the tag limit; skipped: ${plan.skipped.join(', ')}`,
      );
    return this.gateway.addTags(info.id, plan.create);
  }

  /** Give each untagged hub its tag and put it on the hub's synced posts. */
  private async tagHubs(
    channelId: string,
    hubs: readonly BoundHub[],
    tags: readonly ForumTag[],
  ): Promise<void> {
    for (const hub of hubs.filter((h) => h.tagId === null)) {
      const id = findTagId(tags, tagNameFor(hub.hubName));
      if (id === null) continue;
      await setBindingTag(this.db, hub.guildId, id);
      const threads = await linkedThreadIds(this.db, hub.guildId);
      await this.gateway.applyTag(channelId, threads, id);
    }
  }

  /** Put the Event tag on the given hubs' synced event posts. */
  private async tagEvents(
    channelId: string,
    guildIds: readonly number[],
    tags: readonly ForumTag[],
  ): Promise<void> {
    const id = findTagId(tags, EVENT_TAG_NAME);
    if (id === null) return;
    const threads = await linkedEventThreadIds(this.db, guildIds);
    await this.gateway.applyTag(channelId, threads, id);
  }
}
