import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  EVENT_TAG_NAME,
  findTagId,
  planTagCreates,
  shouldRequireTags,
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
 * a bind; `run` answers false so the deploy backfill can retry.
 */
@Injectable()
export class HubForumDiscordDecor {
  private readonly logger = new Logger(HubForumDiscordDecor.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
  ) {}

  /** Dress forum `forumId` (Discord channel `channelId`); true when done. */
  async run(forumId: number, channelId: string): Promise<boolean> {
    try {
      const info = await this.gateway.fetchForum(channelId);
      if (!info) throw new Error('forum not visible');
      if (!info.canManage) throw new Error('missing Manage Channels');
      const hubs = await listForumBindings(this.db, forumId);
      const tags = await this.ensureTags(info, hubs);
      await this.tagHubs(channelId, hubs, tags);
      await this.tagEvents(channelId, hubs, tags);
      await this.gateway.setDefaultReactionIfUnset(channelId);
      if (shouldRequireTags(hubs.length, info.requireTag))
        await this.gateway.requireTags(channelId);
      return true;
    } catch (err) {
      this.logger.warn(`Forum ${channelId} not dressed: ${describe(err)}`);
      return false;
    }
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

  /** Put the Event tag on every synced event post in the forum. */
  private async tagEvents(
    channelId: string,
    hubs: readonly BoundHub[],
    tags: readonly ForumTag[],
  ): Promise<void> {
    const id = findTagId(tags, EVENT_TAG_NAME);
    if (id === null) return;
    const guildIds = hubs.map((h) => h.guildId);
    const threads = await linkedEventThreadIds(this.db, guildIds);
    await this.gateway.applyTag(channelId, threads, id);
  }
}
