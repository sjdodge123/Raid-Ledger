/**
 * ROK-2272 S10 — the kind-agnostic half of a Discord-only planning post
 * (extracted from S4a's `EventPlanningPostsService`): resolve the
 * event-planning forum, find or create the subject's kind tag (Event / Poll /
 * Lineup), let the bot create the post and record it in
 * `event_planning_posts`. A lost race drops our Discord thread and returns
 * the winner; a vanished forum invalidates the resolver.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import type { BoundForum } from './event-planning-forum.queries';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import {
  findLivePlanningPost,
  hubTagIdsOfForum,
  insertPlanningPost,
  type InsertPlanningPostResult,
  type NewPlanningPost,
  type PlanningSubjectKind,
} from './event-planning-posts.queries';
import {
  EVENT_TAG_NAME,
  LINEUP_TAG_NAME,
  POLL_TAG_NAME,
  findKindTagId,
  planTagCreates,
} from './hub-forum-discord-decor';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A live Discord-only post. */
export interface EventPlanningPostRef {
  postId: number;
  forumId: number;
  discordThreadId: string;
}

/** What a new registry post is for and what it says. */
export interface PlanningPostDraftFor {
  kind: PlanningSubjectKind;
  subjectId: number;
  title: string;
  body: string;
  closesAt: Date | null;
}

/** The live post; `created` only when THIS call inserted it. */
export interface CreatedPlanningPost {
  ref: EventPlanningPostRef;
  created: boolean;
}

const KIND_TAG_NAME: Record<PlanningSubjectKind, string> = {
  event: EVENT_TAG_NAME,
  poll: POLL_TAG_NAME,
  lineup: LINEUP_TAG_NAME,
};

export function toPlanningPostRef(
  row: EventPlanningPostSelect,
): EventPlanningPostRef {
  return {
    postId: row.id,
    forumId: row.forumId,
    discordThreadId: row.discordThreadId,
  };
}

@Injectable()
export class EventPlanningPostCreator {
  private readonly logger = new Logger(EventPlanningPostCreator.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly resolver: EventPlanningForumResolver,
    private readonly forums: HubForumDiscordGateway,
    private readonly discord: EventPlanningPostsGateway,
  ) {}

  /** Create + record the post; null when offline, no forum or no tag. */
  async create(
    draft: PlanningPostDraftFor,
  ): Promise<CreatedPlanningPost | null> {
    const forum = await this.forum();
    if (!forum) return null;
    const tagIds = await this.kindTagIds(forum, KIND_TAG_NAME[draft.kind]);
    if (!tagIds) return null;
    const threadId = await this.discord.createPost(forum.channelId, {
      title: draft.title,
      content: draft.body,
      tagIds,
    });
    return this.record(draft, forum.forumId, threadId);
  }

  /** The resolved forum; null when offline or none resolves. */
  private async forum(): Promise<BoundForum | null> {
    const guild = this.forums.guildId();
    if (guild === null || !this.discord.isOnline()) return null;
    return (await this.resolver.resolve(guild)).forum;
  }

  /**
   * [kind tag id] — created on demand like decor does. No usable tag
   * (20-tag cap, or a hub owns the name): untagged, unless the forum
   * requires tags — then null (no post; Discord would refuse it).
   */
  private async kindTagIds(
    forum: BoundForum,
    name: string,
  ): Promise<string[] | null> {
    const info = await this.forums.fetchForum(forum.channelId);
    if (!info) return null;
    const hubTags = await hubTagIdsOfForum(this.db, forum.forumId);
    const id =
      findKindTagId(info.tags, name, hubTags) ??
      (await this.createKindTag(info, hubTags, name));
    if (id !== null) return [id];
    this.logger.warn(`Forum ${info.id} has no usable ${name} tag`);
    return info.requireTag ? null : [];
  }

  private async createKindTag(
    info: ForumInfo,
    hubTags: readonly (string | null)[],
    name: string,
  ): Promise<string | null> {
    const plan = planTagCreates(info.tags, [name]);
    if (plan.create.length === 0) return null;
    const tags = await this.forums.addTags(info.id, plan.create);
    return findKindTagId(tags, name, hubTags);
  }

  /** Record the new post; on a lost race, delete our Discord thread. */
  private async record(
    draft: PlanningPostDraftFor,
    forumId: number,
    discordThreadId: string,
  ): Promise<CreatedPlanningPost | null> {
    const res = await this.insertOrDrop({
      subjectKind: draft.kind,
      subjectId: draft.subjectId,
      forumId,
      discordThreadId,
      closesAt: draft.closesAt,
    });
    if (res.status === 'ok') {
      return { ref: toPlanningPostRef(res.row), created: true };
    }
    await this.dropThread(discordThreadId);
    if (res.status === 'no-forum') {
      this.resolver.invalidate();
      return null;
    }
    const winner = await findLivePlanningPost(
      this.db,
      draft.kind,
      draft.subjectId,
    );
    return winner ? { ref: toPlanningPostRef(winner), created: false } : null;
  }

  /**
   * Review MINOR-2: an untagged insert failure (connection drop, timeout)
   * after the Discord create would orphan the thread — and every retry
   * would make another. Drop it, then rethrow.
   */
  private async insertOrDrop(
    post: NewPlanningPost,
  ): Promise<InsertPlanningPostResult> {
    try {
      return await insertPlanningPost(this.db, post);
    } catch (err) {
      await this.dropThread(post.discordThreadId);
      throw err;
    }
  }

  /** Best effort: a failed cleanup is logged, never thrown. */
  private async dropThread(discordThreadId: string): Promise<void> {
    try {
      await this.discord.deleteThread(discordThreadId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orphan post ${discordThreadId} not deleted: ${why}`);
    }
  }
}
