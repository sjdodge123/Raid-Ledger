import { BossDataRefreshService } from './boss-data-refresh.service';
import { refreshableInstances, upsertBoss } from './boss-data-refresh.helpers';
import type { BlizzardService } from './blizzard.service';
import type { BossEncountersService } from './boss-encounters.service';
import type { DungeonQuestsService } from './dungeon-quests.service';

jest.mock('./boss-data-refresh.helpers', () => ({
  ...jest.requireActual<object>('./boss-data-refresh.helpers'),
  upsertBoss: jest.fn().mockResolvedValue(1),
  processLootItem: jest.fn().mockResolvedValue(false),
}));

/** Retail journal responses: one vanilla tier and one TBC tier. */
const journal: Record<string, unknown> = {
  'journal-expansion/index': {
    tiers: [
      { id: 68, name: 'Classic' },
      { id: 70, name: 'Burning Crusade' },
    ],
  },
  'journal-expansion/68': { name: 'Classic', dungeons: [{ id: 63 }] },
  'journal-expansion/70': { name: 'Burning Crusade', dungeons: [{ id: 248 }] },
  'journal-instance/63': { encounters: [{ id: 1, name: 'Hogger' }] },
  'journal-instance/248': {
    encounters: [{ id: 2, name: 'Watchkeeper Gargolmar' }],
  },
};

function fetchFromJournal(url: string): Promise<unknown> {
  const hit = Object.keys(journal).find((k) => url.includes(`/${k}?`));
  return Promise.resolve(hit ? journal[hit] : null);
}

function buildService(): BossDataRefreshService {
  const blizzard = { fetchBlizzardApi: jest.fn(fetchFromJournal) };
  const clear = { clearCache: jest.fn().mockResolvedValue(undefined) };
  return new BossDataRefreshService(
    {} as never,
    blizzard as unknown as BlizzardService,
    clear as unknown as BossEncountersService,
    clear as unknown as DungeonQuestsService,
  );
}

describe('BossDataRefreshService — classic is seed-only (ROK-2142 review r1)', () => {
  beforeEach(() => jest.mocked(upsertBoss).mockClear());

  it('writes no classic boss row when the retail journal serves a vanilla instance', async () => {
    await buildService().refresh();
    const expansions = jest.mocked(upsertBoss).mock.calls.map((c) => c[4]);
    expect(expansions).not.toContain('classic');
    expect(expansions).toContain('tbc');
  });
});

describe('refreshableInstances (ROK-2142 review r1)', () => {
  it('drops classic instances — the curated JSON is the only classic source', () => {
    expect(
      refreshableInstances([
        { id: 63, expansion: 'classic' },
        { id: 248, expansion: 'tbc' },
      ]),
    ).toEqual([{ id: 248, expansion: 'tbc' }]);
  });
});
