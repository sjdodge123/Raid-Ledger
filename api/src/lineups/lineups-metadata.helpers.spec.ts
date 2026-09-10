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

jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn(),
}));

const findLineupByIdMock = findLineupById as jest.MockedFunction<
  typeof findLineupById
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
