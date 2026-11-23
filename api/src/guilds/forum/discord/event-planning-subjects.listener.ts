/**
 * ROK-2272 S10 — the lifecycle listener for Discord-only posts of NON-HUB
 * polls and lineups (the same Core behaviour as `EventPlanningPostsListener`).
 * A committed vote (`stance` not null) creates the poll's post; a lineup
 * entering voting creates the lineup's; every other emit only re-derives an
 * existing post. Failures are logged and captured, never thrown into the
 * emitter — a Discord or DB error never reaches the vote / nomination.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import * as Sentry from '@sentry/nestjs';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  LINEUP_EVENTS,
  LINEUP_LIFECYCLE_EVENTS,
  type PollVotedPayload,
} from '../../../lineups/lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import { findPollMatchIds } from '../subject-discussion/poll-discussion.queries';
import { payloadId } from '../subject-discussion/poll-discussion.listener';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A field of an emit payload, or undefined. */
function field(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return Reflect.get(payload, key);
}

@Injectable()
export class EventPlanningSubjectsListener {
  private readonly logger = new Logger(EventPlanningSubjectsListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'event-planning.discord-posts';
  /** Kinded: its handlers are lineup/poll emits, not APP_EVENT_EVENTS. */
  readonly hubBehaviourKind = 'event-tagger';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly subjects: EventPlanningSubjectPosts,
    private readonly voterPings: HubForumDiscordPollVoterPings,
  ) {}

  /**
   * A committed vote creates the poll's post and pings the voter once (S10
   * R5, `HubForumDiscordPollVoterPings.planningVote`); a cleared tap does
   * nothing.
   */
  @OnEvent(LINEUP_MATCH_EVENTS.POLL_VOTED, { async: true })
  async onPollVoted(p: PollVotedPayload): Promise<void> {
    if (p.stance === null) return;
    await this.run('poll-voted', p.matchId, () =>
      this.voterPings.planningVote(p),
    );
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { async: true })
  onLockedIn(payload: unknown): Promise<void> {
    return this.syncPoll('locked-in', payload);
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_CANCELLED, { async: true })
  onCancelled(payload: unknown): Promise<void> {
    return this.syncPoll('cancelled', payload);
  }

  @OnEvent(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING, { async: true })
  onEnteredScheduling(payload: unknown): Promise<void> {
    return this.syncPoll('entered-scheduling', payload);
  }

  @OnEvent(LINEUP_EVENTS.DECIDED, { async: true })
  async onDecided(payload: unknown): Promise<void> {
    await this.run('decided', payloadId(payload, 'lineupId'), (id) =>
      this.subjects.syncLineup(id),
    );
  }

  /**
   * building → voting creates the lineup's post (there is no nomination
   * emit; a carrier is never a lineup subject); every edge re-derives the
   * lineup's post and each of its polls'.
   */
  @OnEvent(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, { async: true })
  async onStatusChanged(payload: unknown): Promise<void> {
    const lineupId = payloadId(payload, 'lineupId');
    const opensVoting =
      field(payload, 'to') === 'voting' &&
      field(payload, 'standalone') !== true;
    if (opensVoting) {
      await this.run('status-changed', lineupId, (id) =>
        this.subjects.ensureLineupPost(id),
      );
    }
    await this.run('status-changed', lineupId, (id) =>
      this.subjects.syncLineup(id),
    );
    await this.run('status-changed', lineupId, async (id) => {
      for (const matchId of await findPollMatchIds(this.db, id)) {
        await this.run('status-changed', matchId, (m) =>
          this.subjects.syncPoll(m),
        );
      }
    });
  }

  /**
   * ROK-2287: on every (re)connect, post the voting lineups whose edge found
   * the bot offline (the 5-minute sweep is the backstop). ROK-2301: then
   * re-sync the live poll posts so each takes its derived name.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED, { async: true })
  async onConnected(): Promise<void> {
    await this.guarded('lineup-catch-up', () =>
      this.subjects.ensureMissingLineupPosts(),
    );
    // ROK-2301: existing poll posts take their derived name.
    await this.guarded('poll-title-catch-up', () =>
      this.subjects.resyncLivePollPosts(),
    );
  }

  /** One connect step: logged and captured, never thrown. */
  private async guarded(
    tag: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`event-planning ${tag} failed: ${msg}`);
      Sentry.captureException(err, { tags: { event_planning_posts: tag } });
    }
  }

  private syncPoll(what: string, payload: unknown): Promise<void> {
    return this.run(what, payloadId(payload, 'matchId'), (id) =>
      this.subjects.syncPoll(id),
    );
  }

  private async run(
    what: string,
    id: number | null,
    fn: (id: number) => Promise<unknown>,
  ): Promise<void> {
    if (id === null) return;
    try {
      await fn(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `event-planning subject post (${what}) failed for ${id}: ${msg}`,
      );
      Sentry.captureException(err, {
        tags: { event_planning_posts: what },
      });
    }
  }
}
