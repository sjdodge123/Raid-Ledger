import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DisplayLockoutsRow } from '../plugin-host/extension-points';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { ForeverDisplayLockoutsService } from './forever-display-lockouts.service';

jest.mock('./forever-char-snapshot.query', () => ({
  loadForeverCharSnapshot: jest.fn(),
}));
const loadMock = loadForeverCharSnapshot as jest.MockedFunction<
  typeof loadForeverCharSnapshot
>;

type Snapshot = NonNullable<
  Awaited<ReturnType<typeof loadForeverCharSnapshot>>
>;

const CAPTURED = new Date('2026-10-14T20:00:00.000Z');
const FUTURE_RESET = Math.floor(Date.now() / 1000) + 3 * 86_400;

function snapshot(): Snapshot {
  return {
    data: {
      gear: [],
      talents: { configId: 1, nodes: [] },
      lockouts: [
        {
          name: 'Molten Core',
          instanceId: 409,
          difficultyId: 9,
          resetAt: FUTURE_RESET,
          killed: 3,
          total: 10,
        },
      ],
    },
    capturedAt: CAPTURED,
  };
}

const row = (over: Partial<DisplayLockoutsRow> = {}): DisplayLockoutsRow => ({
  id: 'char-1',
  gameVariant: 'wow_forever',
  ...over,
});

describe('ForeverDisplayLockoutsService (ROK-1743)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  let service: ForeverDisplayLockoutsService;

  beforeEach(() => {
    loadMock.mockReset();
    service = new ForeverDisplayLockoutsService(db);
  });

  it('a non-Forever variant is undefined without querying', async () => {
    loadMock.mockResolvedValue(snapshot());
    expect(
      await service.resolve(row({ gameVariant: 'wow_classic' })),
    ).toBeUndefined();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('no snapshot is undefined', async () => {
    loadMock.mockResolvedValue(null);
    expect(await service.resolve(row())).toBeUndefined();
    expect(loadMock).toHaveBeenCalledWith(db, 'char-1');
  });

  it.each<[string, string | null]>([
    ['the Forever variant', 'wow_forever'],
    ['a null variant (slug-gated loader)', null],
  ])('%s maps the snapshot lockouts', async (_label, gameVariant) => {
    loadMock.mockResolvedValue(snapshot());
    const dto = await service.resolve(row({ gameVariant }));
    expect(dto?.instances).toEqual([
      expect.objectContaining({ name: 'Molten Core', killed: 3, total: 10 }),
    ]);
  });
});
