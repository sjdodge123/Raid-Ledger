/**
 * Turns a Quick Play participant join into an LFG signal (ROK-1451 AC7d).
 *
 * Emits `LFG_EVENTS.QUICK_PLAY_MATCH` when the joining player already holds an
 * active intent on the session's game. That is ALL it does — it never clears,
 * revives or otherwise mutates an intent (AC7c: a Quick Play session must never
 * clear an intent on its own). The rendered offer belongs to the DM/embed
 * sibling story, which subscribes to this event.
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

@Injectable()
export class LfgQuickPlayListener {
  private readonly logger = new Logger(LfgQuickPlayListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Signal a match between a Quick Play session and a live intent.
   *
   * No-ops for unlinked Discord participants (`userId` null), sessions with no
   * game, and players holding no live intent. NEVER throws into the emitter.
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
