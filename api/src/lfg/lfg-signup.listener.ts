/**
 * Clears an LFG intent once the holder signs up for an event for that game
 * (ROK-1451, AC6).
 *
 * Wired to the existing post-commit `signup.created` emitter rather than
 * editing `signups.service.ts`: the seam already exists (see
 * `discord-sync.listener.ts`), it fires after the signup transaction commits,
 * and it keeps the signup path untouched.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot/discord-bot.constants';
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
      await clearIntent(this.db, userId, event.gameId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to clear LFG intent for event ${payload?.eventId}: ${msg}`,
      );
    }
  }
}
