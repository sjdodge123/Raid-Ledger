import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DisplayTalentsRow } from '../plugin-host/extension-points';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { ForeverDisplayTalentsService } from './forever-display-talents.service';

jest.mock('./forever-char-snapshot.query', () => ({
  loadForeverCharSnapshot: jest.fn(),
}));
const loadMock = loadForeverCharSnapshot as jest.MockedFunction<
  typeof loadForeverCharSnapshot
>;

const CAPTURED = new Date('2026-10-09T12:00:00.000Z');
const ORIGINS = [1020, 5020, 9080];

/** One node per (tree, col) at row 0 for the given group origins. */
function positioned(origins: number[]): Record<string, number>[] {
  return origins.flatMap((o, t) =>
    [0, 1].map((c) => ({
      nodeId: 100 + t * 10 + c,
      rank: 1,
      posX: o + c * 600,
      posY: 2130,
    })),
  );
}

type Snapshot = NonNullable<
  Awaited<ReturnType<typeof loadForeverCharSnapshot>>
>;

/** A loader row whose talents carry the given raw nodes. */
function snapshot(nodes: unknown[]): Snapshot {
  return {
    data: { gear: [], lockouts: [], talents: { configId: 7, nodes } },
    capturedAt: CAPTURED,
  } as unknown as Snapshot;
}

const row = (over: Partial<DisplayTalentsRow> = {}): DisplayTalentsRow => ({
  id: 'char-1',
  gameVariant: 'wow_forever',
  talents: null,
  lastSyncedAt: null,
  ...over,
});

describe('ForeverDisplayTalentsService (ROK-1744)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  let service: ForeverDisplayTalentsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    loadMock.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new ForeverDisplayTalentsService(db);
  });
  afterEach(() => warn.mockRestore());

  it('a non-Forever variant is undefined without querying', async () => {
    expect(
      await service.resolve(row({ gameVariant: 'classic_anniversary' })),
    ).toBeUndefined();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('no snapshot (or not on the Forever game) is undefined', async () => {
    loadMock.mockResolvedValue(null);
    expect(await service.resolve(row())).toBeUndefined();
    expect(loadMock).toHaveBeenCalledWith(db, 'char-1');
  });
});

describe('ForeverDisplayTalentsService newest-wins + mapping (D4)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  let service: ForeverDisplayTalentsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    loadMock.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new ForeverDisplayTalentsService(db);
  });
  afterEach(() => warn.mockRestore());

  it('stored talents synced at/after the capture win (D4)', async () => {
    loadMock.mockResolvedValue(snapshot(positioned(ORIGINS)));
    const stored = { talents: { trees: [] } };
    expect(
      await service.resolve(
        row({ ...stored, lastSyncedAt: CAPTURED.toISOString() }),
      ),
    ).toBeUndefined();
    expect(
      await service.resolve(
        row({ ...stored, lastSyncedAt: '2026-10-10T00:00:00.000Z' }),
      ),
    ).toBeUndefined();
  });

  it('stored talents older than the capture yield the addon DTO (D4)', async () => {
    loadMock.mockResolvedValue(snapshot(positioned(ORIGINS)));
    const dto = await service.resolve(
      row({ talents: { trees: [] }, lastSyncedAt: '2026-10-01T00:00:00.000Z' }),
    );
    expect(dto).toMatchObject({
      format: 'forever',
      source: 'addon',
      syncedAt: CAPTURED.toISOString(),
      configId: 7,
      layout: 'grid',
    });
    expect(dto?.nodes).toHaveLength(6);
  });

  it('null stored talents with a newer lastSyncedAt still yield the DTO', async () => {
    loadMock.mockResolvedValue(snapshot([{ nodeId: 1, rank: 2 }]));
    const dto = await service.resolve(
      row({ lastSyncedAt: '2026-10-10T00:00:00.000Z' }),
    );
    expect(dto).toMatchObject({
      layout: 'list',
      nodes: [{ nodeId: 1, rank: 2 }],
    });
  });

  it('an empty node list is undefined', async () => {
    loadMock.mockResolvedValue(snapshot([]));
    expect(await service.resolve(row())).toBeUndefined();
  });

  it('drops malformed nodes from the raw jsonb', async () => {
    loadMock.mockResolvedValue(
      snapshot([{ nodeId: 'x', rank: 1 }, null, { nodeId: 3, rank: 1 }]),
    );
    const dto = await service.resolve(row());
    expect(dto?.nodes).toEqual([{ nodeId: 3, rank: 1 }]);
  });
});

describe('ForeverDisplayTalentsService origin sanity check (Druid ruling)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  let service: ForeverDisplayTalentsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    loadMock.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new ForeverDisplayTalentsService(db);
  });
  afterEach(() => warn.mockRestore());

  it('warns once for a shifted origin set, never bails', async () => {
    loadMock.mockResolvedValue(snapshot(positioned([1020, 5020, 9200])));
    const first = await service.resolve(row());
    await service.resolve(row());
    expect(first?.layout).toBe('grid');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('1020/5020/9200');
  });

  it('does not warn for the known 1020/5020/9080 origins', async () => {
    loadMock.mockResolvedValue(snapshot(positioned(ORIGINS)));
    await service.resolve(row());
    expect(warn).not.toHaveBeenCalled();
  });
});
