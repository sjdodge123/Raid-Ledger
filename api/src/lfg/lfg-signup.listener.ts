/**
 * Clears an LFG intent once the holder signs up for an event for that game
 * (ROK-1451, AC6).
 *
 * Wired to the existing post-commit `signup.created` emitter rather than
 * editing `signups.service.ts`: the seam already exists (see
 * `discord-sync.listener.ts`), it fires after the signup transaction commits,
 * and it keeps the signup path untouched.
 *
 * ROK-2352 Q1: when the signup comes from an LFG conversion (the signer's own
 * hand converted into this very event — a Lock-in or a now-spawn), only the
 * signer's other `now` hands in the game clear; their `tonight` / `week`
 * hands stay up ("tonight could still mean later"). Any other signup still
 * clears every hand the signer holds in the game.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot/discord-bot.constants';
import { clearNowSiblings } from './lfg-lock-in-group.helpers';
import { clearIntent } from './lfg-write.helpers';

@Injectable()
export class LfgSignupListener {
  private readonly logger = new Logger(LfgSignupListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Clear the signer's active intent for the event's game.
   *
   * No-ops for anonymous Discord signups (`userId` null) and for events with
   * no `gameId`. NEVER throws into the emitter — a failed LFG cleanup must not
   * break a signup.
   *
   * @param payload - The `signup.created` payload.
   */
  @OnEvent(SIGNUP_EVENTS.CREATED)
  async onSignupCreated(payload: SignupEventPayload): Promise<void> {
    try {
      const userId = payload?.userId;
      if (!userId) return;
      const [event] = await this.db
        .select({ gameId: schema.events.gameId })
        .from(schema.events)
        .where(eq(schema.events.id, payload.eventId))
        .limit(1);
      if (!event?.gameId) return;
      if (await this.convertedInto(userId, payload.eventId)) {
        await clearNowSiblings(this.db, event.gameId, [userId]);
        return;
      }
      await clearIntent(this.db, userId, event.gameId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to clear LFG intent for event ${payload?.eventId}: ${msg}`,
      );
    }
  }

  /** True when one of the signer's hands converted into this event. */
  private async convertedInto(
    userId: number,
    eventId: number,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.lfgIntents.id })
      .from(schema.lfgIntents)
      .where(
        and(
          eq(schema.lfgIntents.userId, userId),
          eq(schema.lfgIntents.convertedToEventId, eventId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
