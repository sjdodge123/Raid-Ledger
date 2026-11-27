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
import { authorizeAndPersistMetadata } from './lineups-metadata.helpers';
import { findLineupById } from './lineups-query.helpers';
import { applyNominationTargetEdit } from './quorum/nomination-target.helpers';

jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn(),
}));
jest.mock('./quorum/nomination-target.helpers', () => ({
  applyNominationTargetEdit: jest.fn(),
}));

const findLineupByIdMock = findLineupById as jest.MockedFunction<
  typeof findLineupById
>;

const applyEditMock = applyNominationTargetEdit as jest.MockedFunction<
  typeof applyNominationTargetEdit
>;

const CREATOR_ID = 7;
const OUTSIDER_ID = 99;

function lineup(overrides: Record<string, unknown> = {}) {
  return [{ id: 1, status: 'active', createdBy: CREATOR_ID, ...overrides }];
}

/** A db whose update path explodes — every ordering case must throw first. */
const db = {
  update: () => {
    throw new Error('persist should not be reached');
  },
} as never;

describe('authorizeAndPersistMetadata guard ordering', () => {
  beforeEach(() => jest.clearAllMocks());

  async function attempt(
    callerId: number,
    role: string,
    status = 'active',
  ): Promise<unknown> {
    findLineupByIdMock.mockResolvedValue(lineup({ status }) as never);
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
    findLineupByIdMock.mockResolvedValue([] as never);

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

/** A db whose update chain resolves and records each `.set()` payload. */
function recordingDb(): { db: never; sets: Record<string, unknown>[] } {
  const sets: Record<string, unknown>[] = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  } as never;
  return { db, sets };
}

describe('authorizeAndPersistMetadata nomination target gate (ROK-1710)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 409 to the creator when the lineup is not building, before any write', async () => {
    findLineupByIdMock.mockResolvedValue(lineup({ status: 'voting' }) as never);

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
    findLineupByIdMock.mockResolvedValue(lineup({ status: 'voting' }) as never);

    const err = await authorizeAndPersistMetadata(
      db,
      1,
      { nominationTargetPct: 50 },
      { id: OUTSIDER_ID, role: 'member' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('hands a building lineup and the new pct to applyNominationTargetEdit', async () => {
    const row = lineup({ status: 'building' });
    findLineupByIdMock.mockResolvedValue(row as never);
    const { db: okDb } = recordingDb();

    await authorizeAndPersistMetadata(
      okDb,
      1,
      { nominationTargetPct: null },
      { id: OUTSIDER_ID, role: 'operator' },
    );

    expect(applyEditMock).toHaveBeenCalledWith(okDb, row[0], null);
  });

  it('leaves the target alone on a title-only edit outside building', async () => {
    findLineupByIdMock.mockResolvedValue(lineup({ status: 'voting' }) as never);
    const { db: okDb, sets } = recordingDb();

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
