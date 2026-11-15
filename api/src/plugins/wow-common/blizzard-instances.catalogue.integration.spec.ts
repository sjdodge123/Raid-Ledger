/**
 * ROK-2210 — `GET /blizzard/instances` and `GET /blizzard/instance/:id`
 * through the real app: `wow_forever` and `classic_era` are served from the
 * instance catalogue with no Blizzard token and no HTTP call (so they work in
 * an env with no Blizzard keys); ids the catalogue does not hold (Scarlet
 * Halls 311, the retail BRD raid 1301) still go to the live journal.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { BlizzardAuthService } from './blizzard-auth.service';

type Row = { id: number; name: string; expansion: string };

let testApp: TestApp;
let tokenSpy: jest.SpyInstance;
let fetchSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

beforeEach(() => {
  // No Blizzard keys: any token request fails, so a catalogue path that
  // asked for one would surface as an error, not a silent pass.
  tokenSpy = jest
    .spyOn(testApp.app.get(BlizzardAuthService), 'getAccessToken')
    .mockRejectedValue(new Error('no Blizzard keys in this env'));
  fetchSpy = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => jest.restoreAllMocks());

async function list(variant: string, type: 'dungeon' | 'raid') {
  const res = await testApp.request.get(
    `/blizzard/instances?gameVariant=${variant}&type=${type}`,
  );
  expect([res.status, typeof res.body]).toEqual([200, 'object']);
  return (res.body as { data: Row[] }).data;
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

/** No token and no Blizzard HTTP call (the supertest request is not `fetch`). */
function expectNoBlizzardCall() {
  const blizzardUrls = fetchSpy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((url) => url.includes('blizzard.com'));
  expect([tokenSpy.mock.calls.length, blizzardUrls]).toEqual([0, []]);
}

describe('GET /blizzard/instances — catalogue variants (ROK-2210)', () => {
  it('lists 37 Forever-only dungeons for wow_forever', async () => {
    const rows = await list('wow_forever', 'dungeon');
    expect(rows).toHaveLength(37);
    expect(new Set(rows.map((r) => r.expansion))).toEqual(new Set(['Forever']));
    expect(ids(rows)).toEqual(
      expect.arrayContaining([22901, 90_000_001, 90_000_009]),
    );
    expect(ids(rows)).not.toContain(311);
    expect(rows.map((r) => r.name)).not.toContain('Scarlet Halls');
    expectNoBlizzardCall();
  });

  it('lists 9 Forever raids (Classic seven + Barrow Deeps + Hyjal)', async () => {
    const rows = await list('wow_forever', 'raid');
    expect(rows).toHaveLength(9);
    expect(ids(rows)).toEqual(
      expect.arrayContaining([760, 76, 754, 90_000_010, 90_000_011]),
    );
    expect(ids(rows)).not.toContain(1301);
    expectNoBlizzardCall();
  });

  it('lists 28 dungeons / 7 raids labelled Classic for classic_era', async () => {
    const dungeons = await list('classic_era', 'dungeon');
    const raids = await list('classic_era', 'raid');
    expect([dungeons.length, raids.length]).toEqual([28, 7]);
    expect(new Set([...dungeons, ...raids].map((r) => r.expansion))).toEqual(
      new Set(['Classic']),
    );
    expect(ids(raids)).toEqual(expect.arrayContaining([760, 76, 754]));
    expect(ids(raids)).not.toContain(1301);
    expect(ids(dungeons)).toContain(22901);
    expect(ids(dungeons)).not.toContain(311);
    expectNoBlizzardCall();
  });

  it('carries the additive levelSource and wowheadZoneId fields', async () => {
    const rows = await list('wow_forever', 'dungeon');
    expect(rows.find((r) => r.id === 226)).toMatchObject({
      levelSource: 'classic_era',
      wowheadZoneId: 2437,
    });
  });
});

describe('GET /blizzard/instance/:id — catalogue first (ROK-2210 D6)', () => {
  it('resolves UBRS 22901 from the catalogue with no Blizzard call', async () => {
    const res = await testApp.request.get(
      '/blizzard/instance/22901?gameVariant=wow_forever',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 22901,
      name: 'Upper Blackrock Spire',
      expansion: 'Forever',
      maxPlayers: 10,
      category: 'dungeon',
    });
    expectNoBlizzardCall();
  });

  it('sends Scarlet Halls 311 to the live journal', async () => {
    tokenSpy.mockResolvedValue('test-token');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 311,
          name: 'Scarlet Halls',
          expansion: { name: 'Mists of Pandaria' },
          category: { type: 'DUNGEON' },
          modes: [{ mode: { type: 'NORMAL' }, players: 5 }],
        }),
        { status: 200 },
      ),
    );
    const res = await testApp.request.get(
      '/blizzard/instance/311?gameVariant=wow_forever',
    );
    expect([res.status, res.body.name]).toEqual([200, 'Scarlet Halls']);
    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u) => u.includes('journal-instance/311'))).toBe(true);
  });
});
