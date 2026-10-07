import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import { GUID_ALREADY_LINKED_MESSAGE } from './addon-import-binding.apply';
import { AddonImportError } from './addon-import.errors';
import { resolveImportTarget } from './addon-import.target';

const ME = 1;
const OTHER = 2;
const QUERY = {
  userId: ME,
  gameId: 7,
  region: 'us' as const,
  guid: 'Player-4395-0ABCDEF0',
  name: 'Ana Forever',
};

function row(userId: number, addonGuid: string | null) {
  return {
    c: {
      id: '11111111-1111-4111-8111-111111111111',
      userId,
      gameId: 7,
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'pvp',
      class: 'Paladin',
      level: 58,
      addonGuid,
    },
    slug: 'world-of-warcraft-forever',
  };
}

/** `limit` resolves the GUID lookup first, then the name lookup. */
function mockDb(byGuid: unknown[], byName: unknown[] = []) {
  const limit = jest
    .fn()
    .mockResolvedValueOnce(byGuid)
    .mockResolvedValueOnce(byName);
  const chain = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit,
  };
  return { db: chain as unknown as PostgresJsDatabase<typeof schema>, limit };
}

async function rejection(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AddonImportError);
  const e = err as AddonImportError;
  return {
    code: e.code,
    message: (e.getResponse() as { message: string }).message,
  };
}

describe('resolveImportTarget (ROK-1738 D2)', () => {
  it('own GUID holder → update that character, no name lookup', async () => {
    const { db, limit } = mockDb([row(ME, QUERY.guid)]);
    const target = await resolveImportTarget(db, QUERY);
    expect(target).toEqual({
      action: 'update',
      character: {
        id: '11111111-1111-4111-8111-111111111111',
        gameId: 7,
        binding: {
          gameSlug: 'world-of-warcraft-forever',
          name: 'Ana Forever',
          region: 'us',
          ruleset: 'pvp',
          class: 'Paladin',
          level: 58,
          addonGuid: QUERY.guid,
        },
      },
    });
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("another player's GUID → INVALID_PAYLOAD with the ROK-1724 copy", async () => {
    const { db } = mockDb([row(OTHER, QUERY.guid)]);
    expect(await rejection(resolveImportTarget(db, QUERY))).toEqual({
      code: 'INVALID_PAYLOAD',
      message: GUID_ALREADY_LINKED_MESSAGE,
    });
  });

  it("unpinned GUID + another player's name → CHARACTER_CLAIMED", async () => {
    const { db } = mockDb([], [row(OTHER, null)]);
    expect(await rejection(resolveImportTarget(db, QUERY))).toEqual({
      code: 'CHARACTER_CLAIMED',
      message: 'That character is already claimed by another player.',
    });
  });

  it('unpinned GUID + own hand-made name → update it (ruling Q1)', async () => {
    const { db, limit } = mockDb([], [row(ME, null)]);
    const target = await resolveImportTarget(db, QUERY);
    expect(target.action).toBe('update');
    expect(target.action === 'update' && target.character.binding).toEqual(
      expect.objectContaining({ name: 'Ana Forever', addonGuid: null }),
    );
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it('own name pinned to a DIFFERENT GUID → still update (binding asks to confirm)', async () => {
    const { db } = mockDb([], [row(ME, 'Player-4395-0FFFFFFF')]);
    const target = await resolveImportTarget(db, QUERY);
    expect(target.action).toBe('update');
  });

  it('no GUID holder, no name claim → create', async () => {
    const { db, limit } = mockDb([], []);
    expect(await resolveImportTarget(db, QUERY)).toEqual({ action: 'create' });
    expect(limit).toHaveBeenCalledTimes(2);
  });
});
