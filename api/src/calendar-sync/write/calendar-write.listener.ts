/**
 * ROK-1596 D10 / epic ROK-669 §4.5.1: turns signup and event lifecycle emits
 * into `reconcile` jobs on the calendar write queue. It never replays the
 * emit — each job re-reads the world (D1) — and it never throws: a failure is
 * logged + sent to Sentry, and the nightly reconcile heals the missed write.
 *
 * - SIGNUP_EVENTS.* with `userId` → that user's write connections.
 * - with `signupId` but no `userId` → the signup's user is looked up
 *   (internal roster emits such as `tentative_reslotted` omit it); a
 *   Discord-only signup (no user) is skipped.
 * - neither (`roster_updated`), APP_EVENT_EVENTS.UPDATED / CANCELLED →
 *   event-wide fan-out (signups with a write connection ∪ existing links).
 * - DELETED (`emitAsync`, before the row delete) → every link of the event;
 *   the job then finds the event gone and deletes the copy.
 * - RESCHEDULING (poll opened) / RESCHEDULE_CLEARED (poll expired or lineup
 *   aborted, original time kept) → event-wide fan-out (ROK-1857): the job sees
 *   `rescheduling_poll_id` and deletes the copy, or sees it cleared and creates
 *   a fresh one. Lock-in needs nothing new — its UPDATED emits do the create.
 * Bench (F11, ruled 2026-10-11): a benched copy is Free + "(Bench) ".
 * Bench is a roster assignment, not a status, so the reconcile job reads it
 * (`loadSignupBenched`); every bench move already emits SIGNUP_EVENTS.UPDATED
 * — manual roster saves (`roster_updated`, event-wide), bench promotion and
 * priority rejoin (`userId`), `tentative_reslotted` (`signupId`). Known gap:
 * a tentative player displaced to the bench by a newcomer's signup gets no
 * emit of its own; its copy is already Free, and only the "(Tentative)" →
 * "(Bench)" title waits for the nightly reconcile.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  APP_EVENT_EVENTS,
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { SettingsService } from '../../settings/settings.service';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { enqueueCalendarWriteJob } from './calendar-write.enqueue.helpers';
import {
  findEventFanoutKeys,
  findEventLinkKeys,
  findSignupUserId,
  findUserWriteConnectionIds,
} from './calendar-write-fanout.helpers';
import type { ReconcileKey } from './calendar-write-reconcile.helpers';

type KeySource = () => Promise<ReconcileKey[]>;

@Injectable()
export class CalendarWriteListener {
  private readonly logger = new Logger(CalendarWriteListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly queue: Queue,
  ) {}

  @OnEvent(SIGNUP_EVENTS.CREATED)
  onSignupCreated(payload: SignupEventPayload): Promise<void> {
    return this.onSignup(payload);
  }

  @OnEvent(SIGNUP_EVENTS.UPDATED)
  onSignupUpdated(payload: SignupEventPayload): Promise<void> {
    return this.onSignup(payload);
  }

  @OnEvent(SIGNUP_EVENTS.DELETED)
  onSignupDeleted(payload: SignupEventPayload): Promise<void> {
    return this.onSignup(payload);
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  onEventUpdated(payload: { eventId: number }): Promise<void> {
    return this.run(payload.eventId, () =>
      findEventFanoutKeys(this.db, payload.eventId),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  onEventCancelled(payload: { eventId: number }): Promise<void> {
    return this.onEventUpdated(payload);
  }

  /** ROK-1857: poll opened — the job deletes every copy of the event. */
  @OnEvent(APP_EVENT_EVENTS.RESCHEDULING)
  onEventRescheduling(payload: { eventId: number }): Promise<void> {
    return this.onEventUpdated(payload);
  }

  /** ROK-1857: poll cleared without a lock-in — the job restores the copies. */
  @OnEvent(APP_EVENT_EVENTS.RESCHEDULE_CLEARED)
  onRescheduleCleared(payload: { eventId: number }): Promise<void> {
    return this.onEventUpdated(payload);
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  onEventDeleted(payload: { eventId: number }): Promise<void> {
    return this.run(payload.eventId, () =>
      findEventLinkKeys(this.db, payload.eventId),
    );
  }

  private onSignup(payload: SignupEventPayload): Promise<void> {
    const { eventId, userId, signupId } = payload;
    if (userId == null && signupId == null) {
      return this.onEventUpdated({ eventId });
    }
    return this.run(eventId, async () => {
      const uid =
        userId ??
        (signupId != null
          ? await findSignupUserId(this.db, signupId, eventId)
          : null);
      if (uid == null) return []; // Discord-only signup
      const ids = await findUserWriteConnectionIds(this.db, uid);
      return ids.map((connectionId) => ({
        connectionId,
        eventId,
        userId: uid,
      }));
    });
  }

  /** Kill switch first (no DB reads while off), then one job per key. */
  private async run(eventId: number, keys: KeySource): Promise<void> {
    try {
      if (!(await getCalendarSyncEnabled(this.settings))) return;
      const deps = {
        queue: this.queue,
        isSyncEnabled: () => Promise.resolve(true),
      };
      for (const key of await keys()) {
        await enqueueCalendarWriteJob(deps, { kind: 'reconcile', ...key });
      }
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown';
      this.logger.error(
        `calendar write fan-out failed (event ${eventId}): ${code}`,
      );
      Sentry.captureException(err);
    }
  }
}
