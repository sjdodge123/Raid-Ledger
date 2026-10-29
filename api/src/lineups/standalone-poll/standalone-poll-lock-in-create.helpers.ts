/**
 * Claim-first lock-in from the create-event form (ROK-2032).
 *
 * The form used to `POST /events` (which announces on Discord) and only then
 * `POST …/complete` (the compare-and-set), so two organizers locking in the
 * same poll both created and announced an event. This flow CLAIMS the match
 * first, exactly like the expired path (`scheduling-event.helpers`):
 *
 * 1. Validate with no writes (hub permission + provenance via `assertCreate`,
 *    the poll-level `assertCanLockInPoll`, the bench pick's shape).
 * 2. Claim `scheduling` → `scheduled` (committed; a loser 409s, creates nothing).
 * 3. Create the event and sign its creator up. A create throw releases the
 *    claim; a signup throw also deletes the (announced) event first.
 * 4. Link the event; a standalone poll also archives its lineup (one tx).
 * 5. Check the bench pick now that the event exists; a misfit falls back.
 *
 * Side effects (signups, DMs, EVENT CREATED) stay with the caller (L3).
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  type Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
  type CreateEventDto,
  type EventResponseDto,
  type LockInSchedulingPollDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  claimMatchForLockIn,
  linkClaimedMatch,
  releaseMatchClaim,
  type ClaimedFromStatus,
  type LockInClaim,
} from '../scheduling/scheduling-lockin-claim.helpers';
import { assertBenchPick } from './standalone-poll-bench-pick.helpers';
import { selectCompletionTarget } from './standalone-poll-complete.helpers';
import {
  assertCanLockInPoll,
  type Caller,
} from './standalone-poll-auth.helpers';
import type { EventsService } from '../../events/events.service';
import type { SignupsService } from '../../events/signups.service';

type Db = PostgresJsDatabase<typeof schema>;

/** D2: the form path locks in an open poll only — never a `suggested` match. */
const FORM_CLAIMABLE: readonly ClaimedFromStatus[] = ['scheduling'];

/** D6: LFG conversion needs a service this module cannot reach. */
export const LOCK_IN_LFG_REJECTED =
  'lfgGameId cannot be combined with a poll lock-in';

/** D4: a regular lineup match cannot lock in without a time. */
export const LOCK_IN_LINEUP_NEEDS_TIME = 'A lineup poll locks in with a time';

/** Everything the claim-first lock-in reaches outside its own helpers. */
export interface LockInCreateDeps {
  db: Db;
  eventsService: Pick<EventsService, 'create' | 'delete'>;
  signupsService: Pick<SignupsService, 'signup'>;
  logger: Pick<Logger, 'error' | 'warn'>;
  /** `guildTag.assertCreate` + `assertSchedulingMatchUsable`, bound by L3. */
  assertCreate: (dto: CreateEventDto) => Promise<void>;
}

/** One lock-in request: the path's match, the caller and the parsed body. */
export interface LockInRequest {
  matchId: number;
  caller: Caller;
  body: LockInSchedulingPollDto;
}

/** What the lock-in made; the caller runs the fan-out from it. */
export interface LockInCreated {
  event: EventResponseDto;
  /** True for a standalone poll (its lineup was archived). */
  standalone: boolean;
  /** The validated pick that still fits; undefined = server default. */
  bench?: ReadonlySet<number> | undefined;
  /** D3: a pick was sent but no longer fit, so it was dropped. */
  benchPickFallback: boolean;
}

/** The match facts the finish step needs. */
interface LockInMatch {
  id: number;
  lineupId: number;
  standalone: boolean;
}

/**
 * The event DTO for a lock-in: the path param always wins over a body
 * `schedulingMatchId`, and `lfgGameId` is refused (400, D6).
 */
export function toLockInEventDto(
  matchId: number,
  dto: CreateEventDto,
): CreateEventDto {
  if (dto.lfgGameId !== undefined) {
    throw new BadRequestException(LOCK_IN_LFG_REJECTED);
  }
  return { ...dto, schedulingMatchId: matchId };
}

/** Structural bench checks that need no event: no duplicate ids (400). */
function assertBenchShape(ids: readonly number[] | undefined): void {
  if (ids && new Set(ids).size !== ids.length) {
    throw new BadRequestException(
      'Each person can only be picked for the bench once.',
    );
  }
}

/**
 * A lock-in that loses the race BEFORE the claim fails a pre-claim check
 * instead (provenance's 400 "no longer open", or the reschedule guard once
 * the winner linked). It is the same loser as one that loses the claim: 409,
 * so the form shows the Q3 copy. Only {@link assertMayLockIn} routes here — a
 * 400 raised after this request's own claim (its create, say, with a failed
 * release leaving the match `scheduled`) must stay a 400.
 */
async function rethrowAsLoser(
  db: Db,
  matchId: number,
  err: unknown,
): Promise<never> {
  if (!(err instanceof BadRequestException)) throw err;
  const [row] = await db
    .select({ status: schema.communityLineupMatches.status })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  if (row?.status === 'scheduled') {
    throw new ConflictException(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
  }
  throw err;
}

/**
 * Authz first (owner/staff 403/404 via `assertCanLockInPoll`), then the
 * hub-permission + provenance checks. These are the checks a concurrent
 * winner can flip, so a 400 from them on a claimed poll becomes the 409.
 */
async function assertMayLockIn(
  deps: LockInCreateDeps,
  req: LockInRequest,
  dto: CreateEventDto,
): Promise<void> {
  try {
    await assertCanLockInPoll(deps.db, req.matchId, req.caller, {
      eventStart: dto.startTime,
      startTime: req.body.startTime,
    });
    await deps.assertCreate(dto);
  } catch (err: unknown) {
    await rethrowAsLoser(deps.db, req.matchId, err);
  }
}

/**
 * Every pre-claim check. Makes no writes; returns the match to claim. The
 * body-shape 400s (D4, duplicate pick) run after authz so a non-owner gets
 * the authz error, not a validation hint.
 */
async function validateLockIn(
  deps: LockInCreateDeps,
  req: LockInRequest,
  dto: CreateEventDto,
): Promise<LockInMatch> {
  const match = await selectCompletionTarget(deps.db, req.matchId);
  if (!match) throw new NotFoundException('Poll not found');
  await assertMayLockIn(deps, req, dto);
  if (!match.standalone && req.body.startTime === undefined) {
    throw new BadRequestException(LOCK_IN_LINEUP_NEEDS_TIME);
  }
  assertBenchShape(req.body.benchUserIds);
  return {
    id: match.id,
    lineupId: match.lineupId,
    standalone: match.standalone,
  };
}

/** Delete every instance this lock-in made; a failed delete is logged. */
async function discardEvents(
  deps: LockInCreateDeps,
  eventIds: readonly number[],
  userId: number,
): Promise<void> {
  for (const id of eventIds) {
    try {
      await deps.eventsService.delete(id, userId, false);
    } catch (err: unknown) {
      deps.logger.error(
        `Lost lock-in: event ${id} not deleted: ${String(err)}`,
      );
    }
  }
}

type CreatedEvent = EventResponseDto & { allEventIds?: number[] };

/**
 * Create the event, then sign its creator up to every occurrence. A create
 * throw releases the claim. A signup throw comes AFTER `create` emitted
 * EVENT CREATED, so it also deletes every instance first — otherwise a retry
 * would announce a second event (ROK-2032 review M1).
 */
async function createOrRelease(
  deps: LockInCreateDeps,
  match: LockInMatch,
  userId: number,
  dto: CreateEventDto,
  claim: LockInClaim,
): Promise<CreatedEvent> {
  let event: CreatedEvent;
  try {
    event = await deps.eventsService.create(userId, dto);
  } catch (err: unknown) {
    await releaseMatchClaim(deps.db, match.id, claim, deps.logger);
    throw err;
  }
  const eventIds = event.allEventIds ?? [event.id];
  try {
    // Today's `POST /events` behaviour: the creator joins every occurrence.
    for (const id of eventIds) {
      await deps.signupsService.signup(id, userId, undefined, {
        skipEndedCheck: true,
      });
    }
  } catch (err: unknown) {
    await discardEvents(deps, eventIds, userId);
    await releaseMatchClaim(deps.db, match.id, claim, deps.logger);
    throw err;
  }
  return event;
}

/** Link the claimed match and (standalone only) archive its lineup, atomically. */
function linkAndArchive(
  db: Db,
  match: LockInMatch,
  eventId: number,
  claimedAt: Date | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const linked = await linkClaimedMatch(tx, match.id, eventId, claimedAt);
    if (linked && match.standalone) {
      await tx
        .update(schema.communityLineups)
        .set({ status: 'archived' })
        .where(eq(schema.communityLineups.id, match.lineupId));
    }
    return linked;
  });
}

/**
 * Steps 2-4: claim, create, link. A lost link deletes every instance and
 * 409s; a throwing link deletes them, releases the claim and rethrows.
 */
async function claimCreateAndLink(
  deps: LockInCreateDeps,
  match: LockInMatch,
  userId: number,
  dto: CreateEventDto,
): Promise<EventResponseDto> {
  const claim = await claimMatchForLockIn(deps.db, match.id, FORM_CLAIMABLE);
  const created = await createOrRelease(deps, match, userId, dto, claim);
  const { allEventIds, ...event } = created;
  const eventIds = allEventIds ?? [event.id];
  let linked: boolean;
  try {
    linked = await linkAndArchive(deps.db, match, event.id, claim.claimedAt);
  } catch (err: unknown) {
    await discardEvents(deps, eventIds, userId);
    await releaseMatchClaim(deps.db, match.id, claim, deps.logger);
    throw err;
  }
  if (linked) return event;
  await discardEvents(deps, eventIds, userId);
  throw new ConflictException(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
}

/**
 * Step 5 (D3): check the pick against the now-existing event. A pick that no
 * longer fits — or a failed read — is dropped instead of thrown, because the
 * poll is already locked in and announced work must not be undone.
 */
async function resolveBenchPick(
  deps: LockInCreateDeps,
  matchId: number,
  eventId: number,
  body: LockInSchedulingPollDto,
): Promise<Pick<LockInCreated, 'bench' | 'benchPickFallback'>> {
  const { startTime, benchUserIds } = body;
  if (!benchUserIds || startTime === undefined) {
    return { benchPickFallback: false };
  }
  try {
    const bench = await assertBenchPick(deps.db, {
      matchId,
      eventId,
      startTime,
      benchUserIds,
    });
    return { bench, benchPickFallback: false };
  } catch (err: unknown) {
    if (!(err instanceof BadRequestException)) {
      deps.logger.warn(`Lock-in ${matchId}: bench pick unread: ${String(err)}`);
    }
    return { benchPickFallback: true };
  }
}

/**
 * Lock a poll in from the create form, claim-first (ROK-2032 D1). The event
 * exists only once the claim is committed; the loser of a race gets a 409
 * (`SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE`) and creates nothing.
 *
 * @returns The event, the standalone flag and the bench outcome for the
 *   caller's fan-out (signups awaited, then DMs + EVENT CREATED).
 */
export async function createLockedInPollEvent(
  deps: LockInCreateDeps,
  req: LockInRequest,
): Promise<LockInCreated> {
  const dto = toLockInEventDto(req.matchId, req.body.event);
  const match = await validateLockIn(deps, req, dto);
  const event = await claimCreateAndLink(deps, match, req.caller.id, dto);
  const bench = await resolveBenchPick(deps, match.id, event.id, req.body);
  return { event, standalone: match.standalone, ...bench };
}
