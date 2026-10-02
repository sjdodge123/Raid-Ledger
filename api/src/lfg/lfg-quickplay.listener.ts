/**
 * Turns a roster join into an LFG signal (ROK-1451 AC7d) or, on the game's
 * LFG-born session, into a conversion of the joiner's own hand (ROK-1625).
 *
 * Quick Play: emits `LFG_EVENTS.QUICK_PLAY_MATCH` when the joining player
 * already holds an active intent on the session's game, and NEVER mutates an
 * intent (AC7c: a Quick Play session must never clear an intent on its own).
 * The rendered offer belongs to the DM/embed sibling story.
 *
 * The one scoped exception (ROK-1625): when the session IS the game's open
 * LFG-born event (`findOpenLfgNowEventId`, the single provenance definition),
 * the joiner's own live hand converts into it and nothing else moves. It is
 * keyed on `AD_HOC_EVENTS.PARTICIPANT_JOINED` (the roster seam, which fires
 * only on a newly inserted participant) and never on voiceStateUpdate.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { and, eq, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
} from '../discord-bot/discord-bot.constants';
import { LFG_EVENTS } from './lfg.constants';
import { findOpenLfgNowEventId } from './lfg-playing.helpers';
import { convertHolderIntent } from './lfg-write.helpers';

@Injectable()
export class LfgQuickPlayListener {
  private readonly logger = new Logger(LfgQuickPlayListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Convert the joiner's hand on an LFG-born session, otherwise signal a match
   * between a Quick Play session and a live intent.
   *
   * No-ops for unlinked Discord participants (`userId` null), sessions with no
   * game, and players holding no live intent. NEVER throws into the emitter: a
   * failed conversion is logged as a warning naming the event.
   *
   * @param payload - The `ad-hoc.participant.joined` payload.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)
  async onParticipantJoined(
    payload: AdHocParticipantJoinedPayload,
  ): Promise<void> {
    try {
      const userId = payload?.userId;
      if (!userId) return;
      const gameId = await this.resolveGameId(payload.eventId);
      if (!gameId) return;
      if (await this.convertIfLfgBorn(userId, gameId, payload.eventId)) return;
      if (!(await this.holdsLiveIntent(userId, gameId))) return;
      this.eventEmitter.emit(LFG_EVENTS.QUICK_PLAY_MATCH, {
        userId,
        gameId,
        eventId: payload.eventId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to evaluate LFG Quick Play match for event ${payload?.eventId}: ${msg}`,
      );
    }
  }

  /**
   * When `eventId` is the game's open LFG-born event, convert the joiner's own
   * live hand into it (ROK-1625) and report true so no Quick Play signal fires.
   *
   * A Quick Play session for the same game is NOT LFG-born even while one is
   * open, so the comparison is on the exact event id (AC2).
   *
   * @returns True when the session is LFG-born (whether or not a row moved).
   */
  private async convertIfLfgBorn(
    userId: number,
    gameId: number,
    eventId: number,
  ): Promise<boolean> {
    if ((await findOpenLfgNowEventId(this.db, gameId)) !== eventId) {
      return false;
    }
    const converted = await convertHolderIntent(this.db, gameId, userId, {
      eventId,
    });
    if (converted > 0) {
      this.logger.log(
        `Converted user ${userId}'s LFG hand on game ${gameId} into event ${eventId}`,
      );
    }
    return true;
  }

  /** The session's game, or null when it has none. */
  private async resolveGameId(eventId: number): Promise<number | null> {
    const [event] = await this.db
      .select({ gameId: schema.events.gameId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event?.gameId ?? null;
  }

  /** True when the player holds an unexpired `active` intent on the game. */
  private async holdsLiveIntent(
    userId: number,
    gameId: number,
  ): Promise<boolean> {
    const [intent] = await this.db
      .select({ id: schema.lfgIntents.id })
      .from(schema.lfgIntents)
      .where(
        and(
          eq(schema.lfgIntents.userId, userId),
          eq(schema.lfgIntents.gameId, gameId),
          eq(schema.lfgIntents.status, 'active'),
          gt(schema.lfgIntents.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return intent !== undefined;
  }
}
