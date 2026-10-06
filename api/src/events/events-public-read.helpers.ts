/**
 * Per-viewer reads behind `GET /events` and `GET /events/:id` (ROK-1629).
 *
 * Lives outside `events.controller.ts` (at its 300-line lint cap) so each route
 * stays a one-line delegation. Anonymous / deactivated viewers get the public
 * creator + signups-preview projection; members keep today's payload.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  EventListQueryDto,
  EventListResponseDto,
  EventResponseDto,
  PublicEventResponseDto,
} from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { EventsService } from './events.service';
import { enrichEventWithConflicts } from './event-conflict-enrich.helpers';
import { findConflictingEvents } from './event-conflict.helpers';
import {
  isMemberViewer,
  projectEventForViewer,
} from './roster-public-projection.helpers';

/** `req.user` as OptionalJwtGuard leaves it: undefined for anonymous. */
export type EventViewer =
  { id: number; deactivatedAt?: Date | string | null } | null | undefined;

export type PublicEventListResponseDto = Omit<EventListResponseDto, 'data'> & {
  data: Array<EventResponseDto | PublicEventResponseDto>;
};

/** `GET /events` — list with creator + signups preview projected per viewer. */
export async function findEventsForViewer(
  eventsService: EventsService,
  dto: EventListQueryDto,
  viewer: EventViewer,
): Promise<EventListResponseDto | PublicEventListResponseDto> {
  const list = await eventsService.findAll(dto, viewer?.id);
  const isMember = isMemberViewer(viewer);
  if (isMember) return list;
  return {
    ...list,
    data: list.data.map((e) => projectEventForViewer(e, false)),
  };
}

/** `GET /events/:id` — conflict-enriched event, creator projected per viewer. */
export async function findEventForViewer(
  db: PostgresJsDatabase<typeof schema>,
  eventsService: EventsService,
  id: number,
  viewer: EventViewer,
): Promise<EventResponseDto | PublicEventResponseDto> {
  const event = await eventsService.findOne(id);
  const enriched = await enrichEventWithConflicts(
    event,
    viewer?.id ?? null,
    (p) => findConflictingEvents(db, p),
  );
  return projectEventForViewer(enriched, isMemberViewer(viewer));
}
