/**
 * ROK-2226 §5.3 — the event discussion lifecycle listener (a Core-plugin
 * behaviour, ruling 9). Every lifecycle emit reconciles the event's thread;
 * DELETED detaches unconditionally because the single-event delete emits
 * BEFORE the row is gone and the series delete AFTER (D1). Failures are
 * logged, never thrown into the emitter: the lazy GET heals them.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { Db } from '../hub-forum.queries';
import {
  detachEventThreads,
  syncEventDiscussion,
} from './event-discussion.sync';

/** The `eventId` every APP_EVENT_EVENTS payload carries, or null. */
export function lifecycleEventId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id: unknown = Reflect.get(payload, 'eventId');
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

@Injectable()
export class EventDiscussionListener {
  private readonly logger = new Logger(EventDiscussionListener.name);

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  @OnEvent(APP_EVENT_EVENTS.CREATED, { async: true })
  onCreated(payload: unknown): Promise<void> {
    return this.run('created', payload, (id) =>
      syncEventDiscussion(this.db, id),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.UPDATED, { async: true })
  onUpdated(payload: unknown): Promise<void> {
    return this.run('updated', payload, (id) =>
      syncEventDiscussion(this.db, id),
    );
  }

  /** Ruling 3: a cancelled event stays writable until scheduled end + 24 h. */
  @OnEvent(APP_EVENT_EVENTS.CANCELLED, { async: true })
  onCancelled(payload: unknown): Promise<void> {
    return this.run('cancelled', payload, (id) =>
      syncEventDiscussion(this.db, id),
    );
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED, { async: true })
  onDeleted(payload: unknown): Promise<void> {
    return this.run('deleted', payload, (id) =>
      detachEventThreads(this.db, id),
    );
  }

  private async run(
    what: string,
    payload: unknown,
    fn: (eventId: number) => Promise<unknown>,
  ): Promise<void> {
    const eventId = lifecycleEventId(payload);
    if (eventId === null) return;
    try {
      await fn(eventId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `event discussion sync (${what}) failed for event ${eventId}: ${msg}`,
      );
    }
  }
}
