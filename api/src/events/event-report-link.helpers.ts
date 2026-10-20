/**
 * ROK-1725: the event report link — one organiser-pasted log report URL per
 * event occurrence. Writes only `report_url` + `updated_at` and deliberately
 * emits NO lifecycle event: a link is not an event edit, so there is no embed
 * redraw, Discord Scheduled Event write or calendar sync. The URL is already
 * allow-listed by the contract schema and is never fetched server-side.
 */
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UpdateEventReportLinkDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { assertCanUpdate, findExistingEvent } from './event-update.helpers';

/** Sets (or, with `null`, clears) an event's report link. 404 / 403 / 409. */
export async function setEventReportLink(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  isAdmin: boolean,
  dto: UpdateEventReportLinkDto,
): Promise<void> {
  const event = await findExistingEvent(db, eventId);
  assertCanUpdate(event, userId, isAdmin);
  if (event.cancelledAt) {
    throw new ConflictException(
      'Cannot change the report link of a cancelled event',
    );
  }
  await db
    .update(schema.events)
    .set({ reportUrl: dto.reportUrl, updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}
