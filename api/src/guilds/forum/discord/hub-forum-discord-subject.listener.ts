import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  LINEUP_EVENTS,
  LINEUP_LIFECYCLE_EVENTS,
  type LineupDecidedPayload,
  type LineupStatusChangedPayload,
  type PollCancelledPayload,
  type PollLockedInPayload,
  type PollVotedPayload,
} from '../../../lineups/lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import { HubForumDiscordClosingLines } from './hub-forum-discord-closing-lines.service';

/** STATUS_CHANGED edges that abort a lineup subject (not a decide, not a carrier). */
export function isLineupAbort(p: LineupStatusChangedPayload): boolean {
  return p.to === 'archived' && p.from !== 'decided' && !p.standalone;
}

/**
 * ROK-2272 S8 — poll / lineup lifecycle → the hub thread's Discord post: the
 * first vote creates the post, an end posts one closing line. Part of the
 * Core forum sync (`hub-forum.discord-sync`). Failures are logged, never
 * thrown into the lineup write path.
 */
@Injectable()
export class HubForumDiscordSubjectListener {
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;
  private readonly logger = new Logger(HubForumDiscordSubjectListener.name);

  constructor(private readonly closing: HubForumDiscordClosingLines) {}

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_VOTED, { async: true })
  async onPollVoted(p: PollVotedPayload): Promise<void> {
    try {
      await this.closing.firstVote(p.matchId);
    } catch (err) {
      this.warn(`first-vote post for poll ${p.matchId}`, err);
    }
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { async: true })
  async onPollLockedIn(p: PollLockedInPayload): Promise<void> {
    try {
      await this.closing.pollLockedIn(p.matchId, p.eventId);
    } catch (err) {
      this.warn(`lock-in line for poll ${p.matchId}`, err);
    }
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_CANCELLED, { async: true })
  async onPollCancelled(p: PollCancelledPayload): Promise<void> {
    try {
      await this.closing.pollCancelled(p.matchId, p.reason ?? null);
    } catch (err) {
      this.warn(`cancel line for poll ${p.matchId}`, err);
    }
  }

  @OnEvent(LINEUP_EVENTS.DECIDED, { async: true })
  async onLineupDecided(p: LineupDecidedPayload): Promise<void> {
    try {
      await this.closing.lineupDecided(p.lineupId);
    } catch (err) {
      this.warn(`decided line for lineup ${p.lineupId}`, err);
    }
  }

  @OnEvent(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, { async: true })
  async onLineupStatusChanged(p: LineupStatusChangedPayload): Promise<void> {
    if (!isLineupAbort(p)) return;
    try {
      await this.closing.lineupAborted(p.lineupId);
    } catch (err) {
      this.warn(`abort line for lineup ${p.lineupId}`, err);
    }
  }

  private warn(what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Forum ${what}: ${why}`);
  }
}
