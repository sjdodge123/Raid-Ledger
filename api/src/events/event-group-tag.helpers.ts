/**
 * ROK-1832 D6b — when an event update newly tags a group. The late-tag
 * fan-out itself (announced + not started) lives in `HubNotificationService`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { SeriesScope, UpdateEventDto } from '@raid-ledger/contract';
import { resolveTargetEvents } from './event-series.helpers';
import { findExistingOrThrow } from './event-lifecycle.helpers';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { HUB_NOTIFICATION_EVENTS } from '../notifications/hub-notification.constants';

/** True only when the update sets a group that differs from the stored one. */
export function isNewGroupTag(
  next: number | null | undefined,
  stored: number | null,
): next is number {
  return typeof next === 'number' && next !== stored;
}

/**
 * OQ-3: the series occurrences a scoped update newly tags. Read BEFORE the
 * write; a re-save with the same group returns nothing.
 */
export async function findSeriesTagTargets(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
  scope: SeriesScope,
  dto: UpdateEventDto,
): Promise<number[]> {
  const next = dto.guildId;
  if (typeof next !== 'number') return [];
  const anchor = await findExistingOrThrow(db, id);
  const targets = await resolveTargetEvents(db, anchor, scope);
  return targets.filter((t) => isNewGroupTag(next, t.guildId)).map((t) => t.id);
}

/** Fires the late-tag fan-out when an update newly sets a group; a no-op otherwise. */
export function emitNewGroupTag(
  emitter: Pick<EventEmitter2, 'emit'>,
  eventId: number,
  next: number | null | undefined,
  stored: number | null,
): void {
  if (!isNewGroupTag(next, stored)) return;
  emitter.emit(HUB_NOTIFICATION_EVENTS.EVENT_TAGGED, { eventId });
}
