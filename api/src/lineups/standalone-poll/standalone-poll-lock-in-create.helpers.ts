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
 * 3. Create the event and sign its creator up. A throw releases the claim.
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

/** Every pre-claim check. Makes no writes; returns the match to claim. */
async function validateLockIn(
  deps: LockInCreateDeps,
  req: LockInRequest,
  dto: CreateEventDto,
): Promise<LockInMatch> {
  const { matchId, caller, body } = req;
  const match = await selectCompletionTarget(deps.db, matchId);
  if (!match) throw new NotFoundException('Poll not found');
  if (!match.standalone && body.startTime === undefined) {
    throw new BadRequestException(LOCK_IN_LINEUP_NEEDS_TIME);
  }
  assertBenchShape(body.benchUserIds);
  await deps.assertCreate(dto);
  await assertCanLockInPoll(deps.db, matchId, caller, {
    eventStart: dto.startTime,
    startTime: body.startTime,
  });
  return {
    id: match.id,
    lineupId: match.lineupId,
    standalone: match.standalone,
  };
}

/** Create the event + the creator's signup; a throw releases the claim. */
async function createOrRelease(
  deps: LockInCreateDeps,
  match: LockInMatch,
  userId: number,
  dto: CreateEventDto,
  prior: ClaimedFromStatus,
): Promise<EventResponseDto & { allEventIds?: number[] }> {
  try {
    const event = await deps.eventsService.create(userId, dto);
    // Today's `POST /events` behaviour: the creator joins every occurrence.
    for (const id of event.allEventIds ?? [event.id]) {
      await deps.signupsService.signup(id, userId, undefined, {
        skipEndedCheck: true,
      });
    }
    return event;
  } catch (err: unknown) {
    await releaseMatchClaim(deps.db, match.id, prior, deps.logger);
    throw err;
  }
}

/** Link the claimed match and (standalone only) archive its lineup, atomically. */
function linkAndArchive(
  db: Db,
  match: LockInMatch,
  eventId: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const linked = await linkClaimedMatch(tx, match.id, eventId);
    if (linked && match.standalone) {
      await tx
        .update(schema.communityLineups)
        .set({ status: 'archived' })
        .where(eq(schema.communityLineups.id, match.lineupId));
    }
    return linked;
  });
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
  const prior = await claimMatchForLockIn(deps.db, match.id, FORM_CLAIMABLE);
  const created = await createOrRelease(deps, match, userId, dto, prior);
  const { allEventIds, ...event } = created;
  const eventIds = allEventIds ?? [event.id];
  let linked: boolean;
  try {
    linked = await linkAndArchive(deps.db, match, event.id);
  } catch (err: unknown) {
    await discardEvents(deps, eventIds, userId);
    await releaseMatchClaim(deps.db, match.id, prior, deps.logger);
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
