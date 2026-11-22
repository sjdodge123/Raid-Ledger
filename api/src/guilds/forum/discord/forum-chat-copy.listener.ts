/**
 * ROK-2297 D2 — the "copy earlier chat" triggers. A reschedule poll opening
 * for an event copies the event's chat into the poll (event → poll); any poll
 * locking in to an event copies the poll's chat into that event (poll →
 * event). The listener only enqueues (D-5); the processor does the work.
 * Part of the Core `hub-forum.discord-sync` behaviour.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import type { Db } from '../hub-forum.queries';
import { payloadId } from '../subject-discussion/poll-discussion.listener';
import { ForumChatCopyQueue } from './forum-chat-copy.queue';

const matches = schema.communityLineupMatches;

@Injectable()
export class ForumChatCopyListener {
  private readonly logger = new Logger(ForumChatCopyListener.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly queue: ForumChatCopyQueue,
  ) {}

  /** A poll opened: only a reschedule poll (linked event) copies. */
  @OnEvent(LINEUP_MATCH_EVENTS.POLL_OPENED, { async: true })
  async onOpened(payload: unknown): Promise<void> {
    const matchId = payloadId(payload, 'matchId');
    if (matchId === null) return;
    try {
      const eventId = await this.linkedEventId(matchId);
      if (eventId === null) return;
      await this.queue.enqueue({
        direction: 'event-to-poll',
        matchId,
        eventId,
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Chat copy for opened poll ${matchId}: ${why}`);
    }
  }

  /** A poll resolved to an event (moved or new): copy into that event. */
  @OnEvent(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { async: true })
  async onLockedIn(payload: unknown): Promise<void> {
    const matchId = payloadId(payload, 'matchId');
    const eventId = payloadId(payload, 'eventId');
    if (matchId === null || eventId === null) return;
    await this.queue.enqueue({ direction: 'poll-to-event', matchId, eventId });
  }

  private async linkedEventId(matchId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ eventId: matches.linkedEventId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    return row?.eventId ?? null;
  }
}
