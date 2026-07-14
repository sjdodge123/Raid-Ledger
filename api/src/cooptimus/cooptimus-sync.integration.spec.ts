/**
 * Co-Optimus sync integration (ROK-1397) — real Postgres, faked transport.
 *
 * Pins the write-path contract: matched games get ONLY cooptimus_* columns
 * updated (never any other field, never an INSERT into games), an empty
 * envelope stamps the positive "no co-op" state, edition-suffix candidates
 * land in the review queue without mapping, and the transport-disabled
 * module is a clean no-op.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { CooptimusSyncService } from './cooptimus-sync.service';
import { CooptimusService, type CooptimusLookup } from './cooptimus.service';
import type { CooptimusEntry } from './cooptimus-xml.util';

function entry(over: Partial<CooptimusEntry>): CooptimusEntry {
  return {
    id: 9814,
    title: 'Palworld',
    system: 'PC',
    steam: null,
    online: 32,
    local: 0,
    lan: 32,
    splitscreen: false,
    dropInDropOut: true,
    campaign: true,
    featurelist: 'Drop-In/Drop-Out, Campaign Co-Op',
    coopExperience: 'Invite your friends.',
    description: 'A multiplayer game.',
    url: 'https://www.co-optimus.com/game/9814/PC/palworld.html',
    ...over,
  };
}

describe('CooptimusSyncService (integration, ROK-1397)', () => {
  let testApp: TestApp;
  let sync: CooptimusSyncService;
  let cooptimus: CooptimusService;
  let byNameMock: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    sync = testApp.app.get(CooptimusSyncService);
    cooptimus = testApp.app.get(CooptimusService);
  });

  afterEach(async () => {
    byNameMock?.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  function mockLookup(result: CooptimusLookup | null) {
    byNameMock = jest
      .spyOn(cooptimus, 'searchByName')
      .mockResolvedValue(result);
  }

  async function seedGame(name: string, steamAppId: number | null = null) {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
        steamAppId,
      })
      .returning();
    return g;
  }

  async function reload(id: number) {
    const [g] = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, id));
    return g;
  }

  it('matched game gets ONLY cooptimus_* columns updated; no games INSERT', async () => {
    const g = await seedGame('Palworld', 1623730);
    const before = await reload(g.id);
    const countBefore = (await testApp.db.select().from(schema.games)).length;
    mockLookup({ entries: [entry({ steam: 1623730 })], empty: false });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    });

    expect(outcome).toBe('synced');
    const after = await reload(g.id);
    expect(after).toMatchObject({
      cooptimusId: 9814,
      cooptimusOnlineMax: 32,
      cooptimusCouchMax: 0,
      cooptimusLanMax: 32,
      cooptimusSplitscreen: false,
      cooptimusDropIn: true,
      cooptimusCampaignCoop: true,
      cooptimusComboCoop: false,
      cooptimusUrl: 'https://www.co-optimus.com/game/9814/PC/palworld.html',
    });
    expect(after.cooptimusSyncedAt).not.toBeNull();
    expect(after.cooptimusExtras).toMatchObject({
      system: 'PC',
      coopExperience: 'Invite your friends.',
      downloadableOnly: false,
    });
    // Non-cooptimus fields untouched (the clobber-guard rule).
    expect(after.name).toBe(before.name);
    expect(after.steamAppId).toBe(before.steamAppId);
    expect(after.summary).toBe(before.summary);
    // UPDATE-only: row count unchanged.
    const countAfter = (await testApp.db.select().from(schema.games)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('empty envelope stamps the positive "no co-op entry" state', async () => {
    const g = await seedGame('The Witcher 3: Wild Hunt');
    mockLookup({ entries: [], empty: true });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: null,
    });

    expect(outcome).toBe('no-entry');
    const after = await reload(g.id);
    expect(after.cooptimusOnlineMax).toBe(0);
    expect(after.cooptimusCampaignCoop).toBe(false);
    expect(after.cooptimusSyncedAt).not.toBeNull();
    expect(after.cooptimusId).toBeNull();
  });

  it('substring false positives are rejected, not written (Rust→Distrust)', async () => {
    const g = await seedGame('Rust', 252490);
    mockLookup({
      entries: [entry({ id: 77, title: 'Distrust', steam: 635200 })],
      empty: false,
    });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    });

    expect(outcome).toBe('no-entry');
    const after = await reload(g.id);
    expect(after.cooptimusId).toBeNull();
    expect(after.cooptimusOnlineMax).toBe(0); // positive no-entry, not Distrust's data
  });

  it('edition-suffix candidate goes to the review queue, unmapped', async () => {
    const g = await seedGame('Mortal Kombat 11: Ultimate');
    // First query (full name) misses; second (base title) hits.
    byNameMock = jest
      .spyOn(cooptimus, 'searchByName')
      .mockResolvedValueOnce({ entries: [], empty: true })
      .mockResolvedValueOnce({
        entries: [entry({ id: 555, title: 'Mortal Kombat 11' })],
        empty: false,
      });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: null,
    });

    expect(outcome).toBe('review');
    const after = await reload(g.id);
    expect(after.cooptimusId).toBeNull(); // never auto-mapped
    expect(after.cooptimusSyncedAt).not.toBeNull(); // not re-queued weekly
    const queue = await sync.getReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(JSON.parse(queue[0])).toMatchObject({
      gameId: g.id,
      baseTitle: 'Mortal Kombat 11',
    });
  });

  it('transport-disabled (unconfigured) sync is a clean no-op failure, no writes', async () => {
    const g = await seedGame('Deep Rock Galactic', 548430);
    mockLookup(null); // what the service returns when unconfigured

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    });

    expect(outcome).toBe('failed');
    const after = await reload(g.id);
    expect(after.cooptimusSyncedAt).toBeNull(); // untouched — retried next run
  });

  it('pinned cooptimus_id re-syncs by id without a name search', async () => {
    const g = await seedGame('Some Renamed Game');
    const byIdMock = jest
      .spyOn(cooptimus, 'searchById')
      .mockResolvedValue({ entries: [entry({ id: 4242, online: 6 })], empty: false });
    mockLookup({ entries: [], empty: true }); // would be a miss by name

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: 4242,
    });

    expect(outcome).toBe('synced');
    expect(byIdMock).toHaveBeenCalledWith(4242);
    expect(byNameMock).not.toHaveBeenCalled();
    const after = await reload(g.id);
    expect(after.cooptimusId).toBe(4242);
    expect(after.cooptimusOnlineMax).toBe(6);
    byIdMock.mockRestore();
  });
});
