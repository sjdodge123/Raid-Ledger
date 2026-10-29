/**
 * Unit tests for the claim-first lock-in (ROK-2032): the claim commits before
 * any event exists, a lost claim creates nothing, a failed create releases the
 * claim, and a pick that no longer fits falls back softly.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
  type CreateEventDto,
} from '@raid-ledger/contract';
import {
  claimMatchForLockIn,
  linkClaimedMatch,
  releaseMatchClaim,
} from '../scheduling/scheduling-lockin-claim.helpers';
import { assertBenchPick } from './standalone-poll-bench-pick.helpers';
import { selectCompletionTarget } from './standalone-poll-complete.helpers';
import { assertCanLockInPoll } from './standalone-poll-auth.helpers';
import {
  createLockedInPollEvent,
  toLockInEventDto,
  type LockInCreateDeps,
} from './standalone-poll-lock-in-create.helpers';

jest.mock('../scheduling/scheduling-lockin-claim.helpers', () => ({
  claimMatchForLockIn: jest.fn(),
  linkClaimedMatch: jest.fn(),
  releaseMatchClaim: jest.fn(),
}));
jest.mock('./standalone-poll-bench-pick.helpers', () => ({
  assertBenchPick: jest.fn(),
}));
jest.mock('./standalone-poll-complete.helpers', () => ({
  selectCompletionTarget: jest.fn(),
}));
jest.mock('./standalone-poll-auth.helpers', () => ({
  assertCanLockInPoll: jest.fn(),
}));

const claim = jest.mocked(claimMatchForLockIn);
const link = jest.mocked(linkClaimedMatch);
const release = jest.mocked(releaseMatchClaim);
const benchPick = jest.mocked(assertBenchPick);
const target = jest.mocked(selectCompletionTarget);
const canLockIn = jest.mocked(assertCanLockInPoll);

const MATCH_ID = 42;
const START = '2099-01-01T20:00:00.000Z';
const EVENT_DTO: CreateEventDto = {
  title: 'Game night',
  gameId: 7,
  startTime: START,
  endTime: '2099-01-01T22:00:00.000Z',
};

/** Build deps whose every call is appended to a shared call log. */
function buildDeps(log: string[]) {
  const archiveWhere = jest.fn(() => {
    log.push('archive');
    return Promise.resolve();
  });
  const tx = {
    update: jest.fn(() => ({ set: () => ({ where: archiveWhere }) })),
  };
  const create = jest.fn((_userId: number, dto: CreateEventDto) => {
    log.push('create');
    return Promise.resolve({ id: 900, allEventIds: [900, 901], dto });
  });
  // The match-status read behind the pre-claim 400 → 409 remap.
  const statusLimit = jest.fn().mockResolvedValue([{ status: 'scheduling' }]);
  const select = jest.fn(() => ({
    from: () => ({ where: () => ({ limit: statusLimit }) }),
  }));
  const deps = {
    db: {
      transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      select,
    },
    eventsService: { create, delete: jest.fn().mockResolvedValue(undefined) },
    signupsService: {
      signup: jest.fn(() => {
        log.push('signup');
        return Promise.resolve({});
      }),
    },
    logger: { error: jest.fn(), warn: jest.fn() },
    assertCreate: jest.fn(() => {
      log.push('assertCreate');
      return Promise.resolve();
    }),
  };
  return { deps, create, archiveWhere, statusLimit };
}

/** The deps as the helper's interface (the mocks only cover what it calls). */
function asDeps(d: ReturnType<typeof buildDeps>['deps']): LockInCreateDeps {
  return d as unknown as LockInCreateDeps;
}

const caller = { id: 5, isAdmin: false };

beforeEach(() => {
  jest.clearAllMocks();
  target.mockResolvedValue({
    id: MATCH_ID,
    lineupId: 3,
    linkedEventId: null,
    linkedEventCancelled: false,
    standalone: true,
  });
  canLockIn.mockResolvedValue(undefined);
  claim.mockResolvedValue('scheduling');
  link.mockResolvedValue(true);
  release.mockResolvedValue(undefined);
  benchPick.mockResolvedValue(new Set([11]));
});

function run(deps: LockInCreateDeps, extra: Record<string, unknown> = {}) {
  return createLockedInPollEvent(deps, {
    matchId: MATCH_ID,
    caller,
    body: { event: EVENT_DTO, startTime: START, ...extra },
  });
}

describe('toLockInEventDto', () => {
  it('overrides a body schedulingMatchId with the path param', () => {
    const dto = toLockInEventDto(MATCH_ID, {
      ...EVENT_DTO,
      schedulingMatchId: 1,
    });
    expect(dto.schedulingMatchId).toBe(MATCH_ID);
  });

  it('rejects lfgGameId with a 400 (D6)', () => {
    expect(() =>
      toLockInEventDto(MATCH_ID, { ...EVENT_DTO, lfgGameId: 7 }),
    ).toThrow(BadRequestException);
  });
});

describe('createLockedInPollEvent', () => {
  it('runs validate → claim → create → link in that order', async () => {
    const log: string[] = [];
    const { deps } = buildDeps(log);
    claim.mockImplementation(() => {
      log.push('claim');
      return Promise.resolve('scheduling');
    });
    link.mockImplementation(() => {
      log.push('link');
      return Promise.resolve(true);
    });
    const result = await run(asDeps(deps));
    expect(log).toEqual([
      'assertCreate',
      'claim',
      'create',
      'signup',
      'signup',
      'link',
      'archive',
    ]);
    expect(claim).toHaveBeenCalledWith(deps.db, MATCH_ID, ['scheduling']);
    expect(result.event.id).toBe(900);
    expect(result.benchPickFallback).toBe(false);
  });

  it('creates the event with schedulingMatchId = the path param', async () => {
    const { deps, create } = buildDeps([]);
    await createLockedInPollEvent(asDeps(deps), {
      matchId: MATCH_ID,
      caller,
      body: { event: { ...EVENT_DTO, schedulingMatchId: 1 }, startTime: START },
    });
    expect(create.mock.calls[0]?.[1].schedulingMatchId).toBe(MATCH_ID);
  });

  it('loser of the claim gets the 409 and no event is created', async () => {
    const { deps, create } = buildDeps([]);
    claim.mockRejectedValue(
      new ConflictException(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE),
    );
    await expect(run(asDeps(deps))).rejects.toThrow(
      SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
    );
    expect(create).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it('lfgGameId is refused before the claim', async () => {
    const { deps } = buildDeps([]);
    await expect(
      createLockedInPollEvent(asDeps(deps), {
        matchId: MATCH_ID,
        caller,
        body: { event: { ...EVENT_DTO, lfgGameId: 7 }, startTime: START },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(claim).not.toHaveBeenCalled();
  });

  it('a create failure releases the claim with its prior status and rethrows', async () => {
    const { deps, create } = buildDeps([]);
    const boom = new Error('create failed');
    create.mockRejectedValueOnce(boom);
    await expect(run(asDeps(deps))).rejects.toBe(boom);
    expect(release).toHaveBeenCalledWith(
      deps.db,
      MATCH_ID,
      'scheduling',
      deps.logger,
    );
    expect(link).not.toHaveBeenCalled();
  });

  it('a lost link deletes every instance and 409s', async () => {
    const { deps, archiveWhere } = buildDeps([]);
    link.mockResolvedValue(false);
    await expect(run(asDeps(deps))).rejects.toThrow(ConflictException);
    expect(deps.eventsService.delete).toHaveBeenCalledWith(
      900,
      caller.id,
      false,
    );
    expect(deps.eventsService.delete).toHaveBeenCalledWith(
      901,
      caller.id,
      false,
    );
    expect(archiveWhere).not.toHaveBeenCalled();
  });

  it('a link that throws discards the events and releases the claim', async () => {
    const { deps } = buildDeps([]);
    link.mockRejectedValue(new Error('link failed'));
    await expect(run(asDeps(deps))).rejects.toThrow('link failed');
    expect(deps.eventsService.delete).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith(
      deps.db,
      MATCH_ID,
      'scheduling',
      deps.logger,
    );
  });

  it('a regular lineup match is linked but its lineup is not archived', async () => {
    const { deps, archiveWhere } = buildDeps([]);
    target.mockResolvedValue({
      id: MATCH_ID,
      lineupId: 3,
      linkedEventId: null,
      linkedEventCancelled: false,
      standalone: false,
    });
    const result = await run(asDeps(deps));
    expect(link).toHaveBeenCalledWith(expect.anything(), MATCH_ID, 900);
    expect(archiveWhere).not.toHaveBeenCalled();
    expect(result.standalone).toBe(false);
  });

  it('a lineup match without a start time is refused before the claim (D4)', async () => {
    const { deps } = buildDeps([]);
    target.mockResolvedValue({
      id: MATCH_ID,
      lineupId: 3,
      linkedEventId: null,
      linkedEventCancelled: false,
      standalone: false,
    });
    await expect(
      createLockedInPollEvent(asDeps(deps), {
        matchId: MATCH_ID,
        caller,
        body: { event: EVENT_DTO },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(claim).not.toHaveBeenCalled();
  });

  it('applies a pick that fits', async () => {
    const { deps } = buildDeps([]);
    const result = await run(asDeps(deps), { benchUserIds: [11] });
    expect(benchPick).toHaveBeenCalledWith(deps.db, {
      matchId: MATCH_ID,
      eventId: 900,
      startTime: START,
      benchUserIds: [11],
    });
    expect(result.bench).toEqual(new Set([11]));
    expect(result.benchPickFallback).toBe(false);
  });

  it('a pick that no longer fits falls back with the flag and no bench', async () => {
    const { deps } = buildDeps([]);
    benchPick.mockRejectedValue(new BadRequestException('wrong count'));
    const result = await run(asDeps(deps), { benchUserIds: [11] });
    expect(result.benchPickFallback).toBe(true);
    expect(result.bench).toBeUndefined();
    expect(release).not.toHaveBeenCalled();
  });

  it('a duplicate pick is refused before the claim', async () => {
    const { deps } = buildDeps([]);
    await expect(run(asDeps(deps), { benchUserIds: [11, 11] })).rejects.toThrow(
      BadRequestException,
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('a 404 for an unknown poll comes before the claim', async () => {
    const { deps } = buildDeps([]);
    target.mockResolvedValue(null);
    await expect(run(asDeps(deps))).rejects.toThrow('Poll not found');
    expect(claim).not.toHaveBeenCalled();
  });
});

describe('createLockedInPollEvent: cleanup and 409 mapping', () => {
  it('a creator-signup failure deletes every instance, then releases the claim (M1)', async () => {
    const { deps } = buildDeps([]);
    const boom = new Error('signup failed');
    deps.signupsService.signup.mockRejectedValueOnce(boom);
    await expect(run(asDeps(deps))).rejects.toBe(boom);
    const del = deps.eventsService.delete;
    expect(del).toHaveBeenCalledWith(900, caller.id, false);
    expect(del).toHaveBeenCalledWith(901, caller.id, false);
    expect(release).toHaveBeenCalledWith(
      deps.db,
      MATCH_ID,
      'scheduling',
      deps.logger,
    );
    const lastDelete = Math.max(...del.mock.invocationCallOrder);
    expect(lastDelete).toBeLessThan(release.mock.invocationCallOrder[0] ?? 0);
    expect(link).not.toHaveBeenCalled();
  });

  it('a pre-claim 400 on a poll another lock-in claimed becomes the 409', async () => {
    const { deps, statusLimit } = buildDeps([]);
    canLockIn.mockRejectedValue(new BadRequestException('reschedule poll'));
    statusLimit.mockResolvedValue([{ status: 'scheduled' }]);
    await expect(run(asDeps(deps))).rejects.toThrow(
      SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it("the winner's own post-claim 400 stays a 400 while the match is scheduled (m1)", async () => {
    const { deps, create, statusLimit } = buildDeps([]);
    // A failed release leaves the match `scheduled`; that must not read as a lost race.
    statusLimit.mockResolvedValue([{ status: 'scheduled' }]);
    const own = new BadRequestException('bad event');
    create.mockRejectedValueOnce(own);
    await expect(run(asDeps(deps))).rejects.toBe(own);
    expect(statusLimit).not.toHaveBeenCalled();
  });

  it('authz runs before the body-shape 400s: a non-owner gets the 403 (m2)', async () => {
    const { deps, statusLimit } = buildDeps([]);
    canLockIn.mockRejectedValue(new ForbiddenException('not owner'));
    await expect(run(asDeps(deps), { benchUserIds: [11, 11] })).rejects.toThrow(
      ForbiddenException,
    );
    expect(statusLimit).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
});
