/**
 * Join-flow helpers for SeriesSignupsService (ROK-1728): eligibility,
 * anchor resolution, night planning and per-night materialization.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { JoinSeriesDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import type { SignupsService } from './signups.service';
import { fetchEventOrThrow } from './signups-cancel.helpers';
import {
  findJoinableNights,
  findUserRowsForEvents,
  insertMembership,
  tagSignup,
  type NewMembership,
  type SeriesSignupRow,
} from './series-signups.queries';
import {
  ACTIVE_SIGNUP_STATUSES,
  classifyNights,
  type ClassifiedNights,
  type JoinableNight,
} from './series-signups-plan.helpers';

/** User-facing error messages (L6 surfaces them in Discord replies). */
export const SERIES_ERRORS = {
  NOT_SERIES: 'Event is not part of a series',
  INELIGIBLE: 'Your account cannot join a series',
  ALREADY_MEMBER: 'You are already signed up for this series',
  NO_NIGHTS: 'No upcoming nights to join',
  NOT_MEMBER: 'You are not signed up for this series',
  CHANGED: 'Your signup on this night changed while joining',
} as const;

/** The clicked occurrence and its series. */
export interface SeriesAnchor {
  event: typeof schema.events.$inferSelect;
  groupId: string;
  start: Date;
}

/** Nights from the anchor forward, classified for the user (D4). */
export interface NightPlan {
  nights: JoinableNight[];
  classified: ClassifiedNights;
}

/** Outcome of creating the missing nights. */
export interface MaterializeResult {
  createdEventIds: number[];
  failed: { eventId: number; message: string }[];
}

/** Loads the event (404) and requires it to belong to a series (400). */
export async function loadSeriesAnchor(
  db: Tx,
  eventId: number,
): Promise<SeriesAnchor> {
  const event = await fetchEventOrThrow(db, eventId);
  if (!event.recurrenceGroupId)
    throw new BadRequestException(SERIES_ERRORS.NOT_SERIES);
  return { event, groupId: event.recurrenceGroupId, start: event.duration[0] };
}

/** 403 for deactivated, banned or kicked users (covers the Discord path). */
export async function assertEligibleUser(
  db: Tx,
  userId: number,
): Promise<void> {
  const u = schema.users;
  const [user] = await db
    .select({
      deactivatedAt: u.deactivatedAt,
      bannedAt: u.bannedAt,
      kickedAt: u.kickedAt,
    })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  if (!user) throw new NotFoundException(`User ${userId} not found`);
  if (user.deactivatedAt || user.bannedAt || user.kickedAt)
    throw new ForbiddenException(SERIES_ERRORS.INELIGIBLE);
}

/** Reads the joinable nights + the user's rows and classifies them. */
export async function planNights(
  db: Tx,
  anchor: SeriesAnchor,
  userId: number,
  membershipId: number | undefined,
  now: Date,
): Promise<NightPlan> {
  const nights = await findJoinableNights(
    db,
    anchor.groupId,
    anchor.start,
    now,
  );
  const rows = await findUserRowsForEvents(
    db,
    userId,
    nights.map((n) => n.eventId),
  );
  return { nights, classified: classifyNights(nights, rows, membershipId) };
}

/** True for a Postgres unique violation, possibly wrapped by Drizzle. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && err.code === '23505') return true;
  return 'cause' in err && isUniqueViolation(err.cause);
}

/** Inserts the membership; a concurrent join's unique violation → 409. */
export async function insertMembershipOrConflict(
  db: Tx,
  input: NewMembership,
): Promise<SeriesSignupRow> {
  try {
    return await insertMembership(db, input);
  } catch (err: unknown) {
    if (isUniqueViolation(err))
      throw new ConflictException(SERIES_ERRORS.ALREADY_MEMBER);
    throw err;
  }
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_SIGNUP_STATUSES.some((s) => s === status);
}

/** One night: `signup()` then the D3 post-tag. False = changed meanwhile. */
async function materializeOne(
  deps: { db: Tx; signups: Pick<SignupsService, 'signup'> },
  eventId: number,
  userId: number,
  membershipId: number,
  dto: JoinSeriesDto,
): Promise<boolean> {
  const signup = await deps.signups.signup(eventId, userId, dto);
  if (!isActiveStatus(signup.status)) return false;
  return tagSignup(deps.db, signup.id, membershipId);
}

/**
 * Creates the missing nights through `SignupsService.signup` (AC2b) and
 * tags each one after it returns (Q5). Best-effort per night (D5).
 */
export async function materializeNights(
  deps: { db: Tx; signups: Pick<SignupsService, 'signup'> },
  nights: JoinableNight[],
  userId: number,
  membershipId: number,
  dto: JoinSeriesDto,
): Promise<MaterializeResult> {
  const out: MaterializeResult = { createdEventIds: [], failed: [] };
  for (const night of nights) {
    try {
      if (await materializeOne(deps, night.eventId, userId, membershipId, dto))
        out.createdEventIds.push(night.eventId);
      else
        out.failed.push({
          eventId: night.eventId,
          message: SERIES_ERRORS.CHANGED,
        });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      out.failed.push({ eventId: night.eventId, message });
    }
  }
  return out;
}
