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
import { findRevivableEventIds } from './series-signups-rejoin.queries';

/** User-facing error messages (L6 surfaces them in Discord replies). */
export const SERIES_ERRORS = {
  NOT_SERIES: 'Event is not part of a series',
  INELIGIBLE: 'Your account cannot join a series',
  ALREADY_MEMBER: 'You are already signed up for this series',
  NO_NIGHTS: 'No upcoming nights to join',
  NOT_MEMBER: 'You are not signed up for this series',
  CHANGED: 'Your signup on this night changed while joining',
  DUPLICATE: 'You already had a signup on this night',
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
  // Q6: only a non-member re-joining revives the nights their leave declined.
  const revivable =
    membershipId === undefined
      ? await findRevivableEventIds(db, anchor.groupId, userId)
      : new Set<number>();
  return {
    nights,
    classified: classifyNights(nights, rows, membershipId, revivable),
  };
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

/** Outcome of one night: created + tagged, or the failure message. */
type NightOutcome = { ok: true } | { ok: false; message: string };

/** The membership fields materialization needs (id + D3 duplicate cutoff). */
export type MaterializeMembership = Pick<SeriesSignupRow, 'id' | 'joinedAt'>;

interface MaterializeDeps {
  db: Tx;
  signups: Pick<SignupsService, 'signup'>;
}

const DUPLICATE: NightOutcome = { ok: false, message: SERIES_ERRORS.DUPLICATE };
const CHANGED: NightOutcome = { ok: false, message: SERIES_ERRORS.CHANGED };

/**
 * One "create" night (spec §4). A row that appeared since the plan was read
 * is a duplicate: never routed through `signup()`, which would reactivate a
 * declined row (ROK-1769). A row `signup()` returns from before the join is
 * a pre-existing one — also a duplicate, never tagged.
 */
async function materializeOne(
  deps: MaterializeDeps,
  eventId: number,
  userId: number,
  membership: MaterializeMembership,
  dto: JoinSeriesDto,
): Promise<NightOutcome> {
  const current = await findUserRowsForEvents(deps.db, userId, [eventId]);
  if (current.length > 0) return DUPLICATE;
  const signup = await deps.signups.signup(eventId, userId, dto);
  if (new Date(signup.signedUpAt) < membership.joinedAt) return DUPLICATE;
  if (!isActiveStatus(signup.status)) return CHANGED;
  const tagged = await tagSignup(deps.db, signup.id, membership.id);
  return tagged ? { ok: true } : CHANGED;
}

/**
 * Creates the missing nights through `SignupsService.signup` (AC2b) and
 * tags each one after it returns (Q5). Best-effort per night (D5).
 */
export async function materializeNights(
  deps: MaterializeDeps,
  nights: JoinableNight[],
  userId: number,
  membership: MaterializeMembership,
  dto: JoinSeriesDto,
): Promise<MaterializeResult> {
  const out: MaterializeResult = { createdEventIds: [], failed: [] };
  for (const { eventId } of nights) {
    try {
      const res = await materializeOne(deps, eventId, userId, membership, dto);
      if (res.ok) out.createdEventIds.push(eventId);
      else out.failed.push({ eventId, message: res.message });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      out.failed.push({ eventId, message });
    }
  }
  return out;
}
