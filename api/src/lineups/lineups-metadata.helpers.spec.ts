/**
 * Guard ordering for lineup metadata updates (ROK-1077 item 3).
 *
 * The canonical order is existence -> authorisation -> state. Checking the
 * archived flag first answered a caller with no write claim on the row, which
 * is the leak this locks down.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  authorizeAndPersistMetadata,
  runMetadataUpdate,
} from './lineups-metadata.helpers';
import { applyNominationTargetEdit } from './quorum/nomination-target.helpers';

jest.mock('./quorum/nomination-target.helpers', () => ({
  applyNominationTargetEdit: jest.fn(),
}));
jest.mock('./lineups-response.helpers', () => ({
  buildDetailResponse: jest.fn().mockResolvedValue({ id: 1 }),
}));
jest.mock('./lineups-notify-hooks.helpers', () => ({
  fireLineupMetadataRefresh: jest.fn(),
}));

const applyEditMock = applyNominationTargetEdit as jest.MockedFunction<
  typeof applyNominationTargetEdit
>;

const CREATOR_ID = 7;
const OUTSIDER_ID = 99;

function lineup(overrides: Record<string, unknown> = {}) {
  return [{ id: 1, status: 'active', createdBy: CREATOR_ID, ...overrides }];
}

/**
 * A db whose transaction hands back a tx that reads `rows` under a row lock
 * and records each `.set()` payload. With `failUpdate` the update path
 * explodes, so a case that must throw before any write proves it.
 */
function fakeDb(rows: unknown[], opts: { failUpdate?: boolean } = {}) {
  const sets: Record<string, unknown>[] = [];
  const lockModes: string[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (mode: string) => {
            lockModes.push(mode);
            return Promise.resolve(rows);
          },
        }),
      }),
    }),
    update: () => {
      if (opts.failUpdate) throw new Error('persist should not be reached');
      return {
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Promise.resolve() };
        },
      };
    },
  };
  const db = {
    transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as never;
  return { db, tx, sets, lockModes };
}

describe('authorizeAndPersistMetadata guard ordering', () => {
  beforeEach(() => jest.clearAllMocks());

  async function attempt(
    callerId: number,
    role: string,
    status = 'active',
  ): Promise<unknown> {
    const { db } = fakeDb(lineup({ status }), { failUpdate: true });
    return authorizeAndPersistMetadata(
      db,
      1,
      { title: 'x' },
      {
        id: callerId,
        role,
      },
    ).catch((e: unknown) => e);
  }

  it('tells an outsider 403 before it tells them the lineup is archived', async () => {
    const err = await attempt(OUTSIDER_ID, 'member', 'archived');

    // Pre-fix this was ConflictException — a caller with no write claim
    // learned the lineup's state from the status code.
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('still returns 409 to the creator of an archived lineup', async () => {
    const err = await attempt(CREATOR_ID, 'member', 'archived');

    expect(err).toBeInstanceOf(ConflictException);
  });

  it('still returns 409 to an operator on an archived lineup', async () => {
    const err = await attempt(OUTSIDER_ID, 'operator', 'archived');

    expect(err).toBeInstanceOf(ConflictException);
  });

  it('returns 403 to an outsider on an active lineup', async () => {
    const err = await attempt(OUTSIDER_ID, 'member');

    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when the lineup does not exist', async () => {
    const { db } = fakeDb([], { failUpdate: true });

    const err = await authorizeAndPersistMetadata(
      db,
      1,
      { title: 'x' },
      {
        id: OUTSIDER_ID,
        role: 'member',
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe('authorizeAndPersistMetadata nomination target gate (ROK-1710)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 409 to the creator when the lineup is not building, before any write', async () => {
    const { db } = fakeDb(lineup({ status: 'voting' }), { failUpdate: true });

    const err = await authorizeAndPersistMetadata(
      db,
      1,
      { title: 'x', nominationTargetPct: 50 },
      { id: CREATOR_ID, role: 'member' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      'Nomination target can only be changed while nominating',
    );
    expect(applyEditMock).not.toHaveBeenCalled();
  });

  it('tells an outsider 403 before the not-building 409', async () => {
    const { db } = fakeDb(lineup({ status: 'voting' }), { failUpdate: true });

    const err = await authorizeAndPersistMetadata(
      db,
      1,
      { nominationTargetPct: 50 },
      { id: OUTSIDER_ID, role: 'member' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('hands the locked building row and the new pct to applyNominationTargetEdit inside the transaction', async () => {
    const row = lineup({ status: 'building' });
    const { db: okDb, tx, lockModes } = fakeDb(row);

    await authorizeAndPersistMetadata(
      okDb,
      1,
      { nominationTargetPct: null },
      { id: OUTSIDER_ID, role: 'operator' },
    );

    // The same tx that read the row under the lock does the target write, so a
    // status change cannot land between the guard and the write.
    expect(applyEditMock).toHaveBeenCalledWith(tx, row[0], null);
    expect(lockModes).toEqual(['no key update']);
  });

  it('leaves the target alone on a title-only edit outside building', async () => {
    const { db: okDb, sets } = fakeDb(lineup({ status: 'voting' }));

    await authorizeAndPersistMetadata(
      okDb,
      1,
      { title: 'Renamed' },
      { id: CREATOR_ID, role: 'member' },
    );

    expect(applyEditMock).not.toHaveBeenCalled();
    expect(sets[0]).toMatchObject({ title: 'Renamed' });
    expect(sets[0]).not.toHaveProperty('nominationTargetPct');
  });
});

describe('runMetadataUpdate grace job hygiene (ROK-1710 Codex P2)', () => {
  beforeEach(() => jest.clearAllMocks());

  async function run(dto: { nominationTargetPct?: number | null }) {
    const { db } = fakeDb(lineup({ status: 'building' }));
    const phaseQueue = { cancelGraceAdvance: jest.fn() };
    await runMetadataUpdate(
      db,
      {} as never,
      phaseQueue,
      { warn: jest.fn() } as never,
      1,
      dto,
      { id: CREATOR_ID, role: 'member' },
    );
    return phaseQueue.cancelGraceAdvance;
  }

  it('cancels the queued grace job after a target edit that wrote', async () => {
    applyEditMock.mockResolvedValue(true);
    const cancel = await run({ nominationTargetPct: 55 });
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('leaves the grace job alone on a no-op target edit', async () => {
    applyEditMock.mockResolvedValue(false);
    expect(await run({ nominationTargetPct: 50 })).not.toHaveBeenCalled();
  });
});
