/**
 * ROK-2272 S7b — the community-lineup discussion lifecycle listener (a Core
 * behaviour under the same `poll-discussion` manifest row, spec §5/R9: its
 * label covers "scheduling poll and lineup"). Lineup create and every status
 * edge reconcile the lineup's thread. Failures are logged, never thrown into
 * the emitter (the lazy GET heals them).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { LINEUP_LIFECYCLE_EVENTS } from '../../../lineups/lineup-events.constants';
import type { Db } from '../hub-forum.queries';
import { syncLineupDiscussion } from './lineup-discussion.sync';
import { payloadId } from './poll-discussion.listener';

@Injectable()
export class LineupDiscussionListener {
  private readonly logger = new Logger(LineupDiscussionListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'poll-discussion';
  readonly hubBehaviourKind = 'event-tagger';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  // R6 note: no subscription covers a lineup's `visibility` or `guildId`
  // changing, because no code path edits either column today. If one is
  // added, emit a lineup event from it; until then the lazy sync on the
  // discussion GET (`syncLineupDiscussion`) converges the thread on next read.

  /** A lineup was created (R4: hub RL thread at create). */
  @OnEvent(LINEUP_LIFECYCLE_EVENTS.CREATED, { async: true })
  onCreated(payload: unknown): Promise<void> {
    return this.syncLineup('created', payload);
  }

  /** Any status edge (voting, decided, archived, reverted). */
  @OnEvent(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, { async: true })
  onStatusChanged(payload: unknown): Promise<void> {
    return this.syncLineup('status-changed', payload);
  }

  private async syncLineup(what: string, payload: unknown): Promise<void> {
    const lineupId = payloadId(payload, 'lineupId');
    if (lineupId === null) return;
    try {
      await syncLineupDiscussion(this.db, lineupId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `lineup discussion sync (${what}) failed for lineup ${lineupId}: ${msg}`,
      );
    }
  }
}
