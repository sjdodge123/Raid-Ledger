import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { PelicanServersRepository } from './pelican-servers.repository';
import type { ListedServer } from './pelican-sync.helpers';

const NOW = new Date('2026-10-13T12:00:00Z');
const dialect = new PgDialect();
const render = (cond: unknown) => dialect.sqlToQuery(cond as SQL);
const listed = (n: number): ListedServer => ({
  panelUuid: `uuid-${n}`,
  identifier: `id-${n}`,
  name: `Server ${n}`,
});

function build() {
  const db = createDrizzleMock();
  db.returning.mockResolvedValue([]);
  const repo = new PelicanServersRepository(db as never);
  return { db, repo };
}

describe('PelicanServersRepository.upsertListed', () => {
  it('updates only identifier, name, last_synced_at, missing_since on conflict', async () => {
    const { db, repo } = build();
    db.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    expect(await repo.upsertListed(db as never, [listed(1), listed(2)], NOW)).toBe(2);
    const arg = db.onConflictDoUpdate.mock.calls[0]?.[0] as {
      set: Record<string, unknown>;
    };
    expect(Object.keys(arg.set).sort()).toEqual([
      'identifier',
      'lastSyncedAt',
      'missingSince',
      'name',
    ]);
    expect(arg.set).toMatchObject({ lastSyncedAt: NOW, missingSince: null });
  });

  it('inserts no admin or status column', async () => {
    const { db, repo } = build();
    await repo.upsertListed(db as never, [listed(1)], NOW);
    expect(db.values).toHaveBeenCalledWith([
      { ...listed(1), lastSyncedAt: NOW },
    ]);
  });

  it('issues no statement for an empty listing', async () => {
    const { db, repo } = build();
    expect(await repo.upsertListed(db as never, [], NOW)).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('PelicanServersRepository.markMissing', () => {
  it('stamps only present rows absent from the listing', async () => {
    const { db, repo } = build();
    db.returning.mockResolvedValueOnce([{ id: 7 }]);
    expect(await repo.markMissing(db as never, ['uuid-1', 'uuid-2'], NOW)).toBe(1);
    expect(db.set).toHaveBeenCalledWith({ missingSince: NOW });
    const q = render(db.where.mock.calls[0]?.[0]);
    expect(q.sql).toBe(
      '("pelican_servers"."missing_since" is null and "pelican_servers"."panel_uuid" not in ($1, $2))',
    );
    expect(q.params).toEqual(['uuid-1', 'uuid-2']);
  });

  it('marks every present row when the complete listing is empty', async () => {
    const { db, repo } = build();
    await repo.markMissing(db as never, [], NOW);
    const q = render(db.where.mock.calls[0]?.[0]);
    expect(q.sql).toBe('"pelican_servers"."missing_since" is null');
  });
});

describe('PelicanServersRepository.applyListing', () => {
  it('counts restored rows, upserts, then marks missing in one transaction', async () => {
    const { db, repo } = build();
    db.where
      .mockReturnValueOnce(Promise.resolve([{ id: 3 }]))
      .mockReturnThis();
    db.returning
      .mockResolvedValueOnce([{ id: 1 }, { id: 3 }])
      .mockResolvedValueOnce([{ id: 9 }]);
    const counts = await repo.applyListing([listed(1), listed(3)], NOW);
    expect(counts).toEqual({ upserted: 2, markedMissing: 1, restored: 1 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const restoredWhere = render(db.where.mock.calls[0]?.[0]);
    expect(restoredWhere.sql).toContain('"missing_since" is not null');
  });
});
