/**
 * ROK-2272 S7a — the scheduling-poll discussion lifecycle listener (a Core
 * behaviour, spec §5/R9). Every S6 poll emit reconciles the poll's thread;
 * a lineup status change reconciles each of the lineup's polls. Failures are
 * logged, never thrown into the emitter (the lazy GET heals them).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { LINEUP_LIFECYCLE_EVENTS } from '../../../lineups/lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import type { Db } from '../hub-forum.queries';
import { findPollMatchIds } from './poll-discussion.queries';
import { syncPollDiscussion } from './poll-discussion.sync';

/** A positive integer `key` of an emit payload, or null. */
export function payloadId(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id: unknown = Reflect.get(payload, key);
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

@Injectable()
export class PollDiscussionListener {
  private readonly logger = new Logger(PollDiscussionListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'poll-discussion';
  readonly hubBehaviourKind = 'event-tagger';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** A standalone poll was created (R4: hub RL thread at create). */
  @OnEvent(LINEUP_MATCH_EVENTS.POLL_OPENED, { async: true })
  onOpened(payload: unknown): Promise<void> {
    return this.syncMatch('opened', payload);
  }

  /** A lineup match entered scheduling (opened or reopened). */
  @OnEvent(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING, { async: true })
  onEnteredScheduling(payload: unknown): Promise<void> {
    return this.syncMatch('entered-scheduling', payload);
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { async: true })
  onLockedIn(payload: unknown): Promise<void> {
    return this.syncMatch('locked-in', payload);
  }

  @OnEvent(LINEUP_MATCH_EVENTS.POLL_CANCELLED, { async: true })
  onCancelled(payload: unknown): Promise<void> {
    return this.syncMatch('cancelled', payload);
  }

  /** A lineup status edge (archive, revert…) — reconcile each of its polls. */
  @OnEvent(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, { async: true })
  async onLineupStatusChanged(payload: unknown): Promise<void> {
    const lineupId = payloadId(payload, 'lineupId');
    if (lineupId === null) return;
    try {
      for (const matchId of await findPollMatchIds(this.db, lineupId)) {
        await syncPollDiscussion(this.db, matchId);
      }
    } catch (err) {
      this.warn(`lineup-status-changed`, `lineup ${lineupId}`, err);
    }
  }

  private async syncMatch(what: string, payload: unknown): Promise<void> {
    const matchId = payloadId(payload, 'matchId');
    if (matchId === null) return;
    try {
      await syncPollDiscussion(this.db, matchId);
    } catch (err) {
      this.warn(what, `match ${matchId}`, err);
    }
  }

  private warn(what: string, subject: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `poll discussion sync (${what}) failed for ${subject}: ${msg}`,
    );
  }
}
