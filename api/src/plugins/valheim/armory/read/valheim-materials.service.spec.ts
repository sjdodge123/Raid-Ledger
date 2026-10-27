/**
 * ROK-1853 review M2 — every Materials read (the scan lookup and its
 * queries) runs on one read-only REPEATABLE READ transaction handle, so an
 * import committing mid-request cannot mix old and new totals. The root
 * pool handle must never see a select.
 */
import type { AuthenticatedUser } from '../../../../auth/types';
import type { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { ValheimMaterialsRepository } from './valheim-materials.repository';
import { ValheimMaterialsService } from './valheim-materials.service';

const SCAN = {
  id: 9,
  worldUid: 'w-1',
  capturedAt: new Date('2026-10-20T10:00:00Z'),
  gameVersion: '0.220.5',
  omittedShared: 0,
  omittedPrivate: 0,
};
const KEY = 'a'.repeat(22);
const CHEST = {
  key: KEY,
  prefab: 'piece_chest',
  x: 1,
  y: 2,
  z: 3,
  privacy: 'public',
  vehicle: false,
  slots: 18,
  usedSlots: 1,
  unreadable: false,
  omittedEntries: 0,
  stackCount: 1,
};

/** The chest as the base-inputs query returns it (ROK-1859). */
const INPUT = {
  key: KEY,
  prefab: 'piece_chest',
  x: 1,
  y: 2,
  z: 3,
  vehicle: false,
  shared: true,
};

const USER: AuthenticatedUser = {
  id: 2,
  username: 'member',
  role: 'member',
  discordId: null,
  deactivatedAt: null,
  impersonatedBy: null,
  tokenVersion: 0,
};

/** A thenable query chain resolving to `rows` whatever the builder calls. */
function chain(rows: unknown[]): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) {
    c[m] = () => c;
  }
  c['groupBy'] = () => c;
  c['then'] = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return c;
}

function harness(results: unknown[][]) {
  const tx = { select: jest.fn(() => chain(results.shift() ?? [])) };
  const db = {
    select: jest.fn(() => {
      throw new Error('read outside the materials transaction');
    }),
    transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const hubs = {
    findServerHub: () => Promise.resolve({ id: 1, hidden: false }),
  } as Pick<ValheimArmoryReadRepository, 'findServerHub'>;
  const repo = new ValheimMaterialsRepository(
    db as unknown as ConstructorParameters<
      typeof ValheimMaterialsRepository
    >[0],
  );
  const service = new ValheimMaterialsService(
    hubs as ValheimArmoryReadRepository,
    repo,
  );
  return { db, tx, service };
}

const READ_ONLY_RR = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
};

describe('ValheimMaterialsService — one read-only transaction per request', () => {
  it('materials: scan lookup + four totals/counts + base inputs/sums + catalog on the tx handle', async () => {
    const { db, tx, service } = harness([[SCAN]]);
    await service.materials(7, USER, false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      READ_ONLY_RR,
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(tx.select).toHaveBeenCalledTimes(8);
  });

  it('containers: scan lookup + list + base inputs + catalog on the tx handle', async () => {
    const { db, tx, service } = harness([[SCAN], [CHEST], [INPUT]]);
    await service.containers(7, USER, false);
    expect(db.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      READ_ONLY_RR,
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(tx.select).toHaveBeenCalledTimes(4);
  });

  it('container: scan lookup + chest + stacks + base inputs on the tx handle', async () => {
    const { db, tx, service } = harness([
      [SCAN],
      [{ ...CHEST, id: 4 }],
      [],
      [INPUT],
    ]);
    await service.container(7, KEY, USER, false);
    expect(db.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      READ_ONLY_RR,
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(tx.select).toHaveBeenCalledTimes(4);
  });
});
