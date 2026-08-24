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
import {
  UNKNOWN_PAGE_FACTS,
  type CooptimusPageFacts,
} from './cooptimus-page.util';
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
  let pageMock: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    sync = testApp.app.get(CooptimusSyncService);
    cooptimus = testApp.app.get(CooptimusService);
  });

  beforeEach(() => {
    // Safety net: the game-page fetch is a REAL outbound request. Default it to
    // "unknown" for every test so no spec can ever hit co-optimus.com; tests
    // that care override it via mockPageFacts().
    pageMock = jest
      .spyOn(cooptimus, 'fetchGamePageFacts')
      .mockResolvedValue(UNKNOWN_PAGE_FACTS);
  });

  afterEach(async () => {
    byNameMock?.mockRestore();
    pageMock?.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  function mockPageFacts(facts: Partial<CooptimusPageFacts>) {
    pageMock.mockResolvedValue({ ...UNKNOWN_PAGE_FACTS, ...facts });
  }

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
    mockPageFacts({
      comboCoop: true,
      comboLabel: 'Up to 4 Local or Online',
      downloadableOnly: false,
    });

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
      cooptimusComboCoop: true,
      cooptimusUrl: 'https://www.co-optimus.com/game/9814/PC/palworld.html',
    });
    expect(after.cooptimusSyncedAt).not.toBeNull();
    expect(after.cooptimusExtras).toMatchObject({
      system: 'PC',
      coopExperience: 'Invite your friends.',
      downloadableOnly: false,
      comboLabel: 'Up to 4 Local or Online',
    });
    // Non-cooptimus fields untouched (the clobber-guard rule).
    expect(after.name).toBe(before.name);
    expect(after.steamAppId).toBe(before.steamAppId);
    expect(after.summary).toBe(before.summary);
    // UPDATE-only: row count unchanged.
    const countAfter = (await testApp.db.select().from(schema.games)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('unreadable game page persists NULL combo/downloadable, never false', async () => {
    // Regression: combo + downloadable-only exist ONLY on the rendered page
    // (games.php returns neither). The old code inferred them from
    // <featurelist>, which never contains those tokens, so every game was
    // written as false — Baldur's Gate III said "Not Supported" while
    // co-optimus.com said "Up to 4 Local or Online". A page we cannot read
    // must leave the fact unknown so the UI omits the row.
    const g = await seedGame('Palworld', 1623730);
    mockLookup({ entries: [entry({ steam: 1623730 })], empty: false });
    mockPageFacts(UNKNOWN_PAGE_FACTS);

    expect(
      await sync.syncGame({
        id: g.id,
        name: g.name,
        steamAppId: g.steamAppId,
        cooptimusId: null,
      }),
    ).toBe('synced');

    const after = await reload(g.id);
    expect(after.cooptimusComboCoop).toBeNull();
    expect(after.cooptimusExtras).toMatchObject({ downloadableOnly: null });
    // The API-sourced facts still land — only the page-sourced ones are unknown.
    expect(after.cooptimusOnlineMax).toBe(32);
  });

  it('a transient page failure PRESERVES previously sourced page facts', async () => {
    // Stale rows re-sync every COOPTIMUS_STALE_AFTER_DAYS. Without the merge, a
    // single timeout on the re-read would blank combo/downloadable for a game
    // whose facts we had already read correctly (Codex pre-push review).
    const g = await seedGame('Palworld', 1623730);
    const row = {
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    };
    mockLookup({ entries: [entry({ steam: 1623730 })], empty: false });
    mockPageFacts({
      comboCoop: true,
      comboLabel: 'Up to 4 Local or Online',
      downloadableOnly: true,
    });
    expect(await sync.syncGame(row)).toBe('synced');

    // Re-sync while the page is unreadable.
    mockPageFacts(UNKNOWN_PAGE_FACTS);
    expect(await sync.syncGame(row)).toBe('synced');

    const after = await reload(g.id);
    expect(after.cooptimusComboCoop).toBe(true);
    expect(after.cooptimusExtras).toMatchObject({
      comboLabel: 'Up to 4 Local or Online',
      downloadableOnly: true,
    });
  });

  it('does NOT carry page facts across a remap to a different entry', async () => {
    // Preserve-on-transient-failure must be scoped to the SAME Co-Optimus
    // entry. Remapped to a different game, the stored combo/downloadable
    // describe another title — republishing them under the Co-Optimus credit
    // is the very bug this change fixes (Codex pre-push review).
    const g = await seedGame('Palworld', 1623730);
    const row = {
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    };
    mockLookup({ entries: [entry({ steam: 1623730 })], empty: false });
    mockPageFacts({
      comboCoop: true,
      comboLabel: 'Up to 4 Local or Online',
      downloadableOnly: true,
    });
    expect(await sync.syncGame(row)).toBe('synced');

    // Now the name resolves to a DIFFERENT Co-Optimus entry and its page is
    // unreadable. The previous entry's facts must not follow it across.
    mockLookup({
      entries: [entry({ id: 12345, steam: 1623730 })],
      empty: false,
    });
    mockPageFacts(UNKNOWN_PAGE_FACTS);
    expect(await sync.syncGame(row)).toBe('synced');

    const after = await reload(g.id);
    expect(after.cooptimusId).toBe(12345);
    expect(after.cooptimusComboCoop).toBeNull();
    expect(after.cooptimusExtras).toMatchObject({
      comboLabel: null,
      downloadableOnly: null,
    });
  });

  it('CLEARS legacy featurelist-derived flags rather than preserving them', async () => {
    // Rows synced before this change hold `false` from the old regex, which was
    // never page-sourced. On the first post-deploy re-sync, an unknown page read
    // must NOT resurrect them — otherwise the games this fix exists for keep
    // rendering "Not Supported" (Codex pre-push review).
    const g = await seedGame('Palworld', 1623730);
    await testApp.db
      .update(schema.games)
      .set({
        cooptimusId: 9814,
        cooptimusComboCoop: false, // legacy value, no pageFactsAt provenance
        cooptimusExtras: { system: 'PC', downloadableOnly: false },
        cooptimusSyncedAt: new Date('2026-08-01T00:00:00.000Z'),
      })
      .where(eq(schema.games.id, g.id));

    mockLookup({ entries: [entry({ steam: 1623730 })], empty: false });
    mockPageFacts(UNKNOWN_PAGE_FACTS);

    expect(
      await sync.syncGame({
        id: g.id,
        name: g.name,
        steamAppId: g.steamAppId,
        // Unpinned so this takes the name-search path we mocked; the DB row
        // still carries cooptimusId 9814, which is what the entry-match check
        // compares against.
        cooptimusId: null,
      }),
    ).toBe('synced');

    const after = await reload(g.id);
    expect(after.cooptimusComboCoop).toBeNull();
    expect(after.cooptimusExtras).toMatchObject({ downloadableOnly: null });
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

  it('garbage 200 (zero entries, NOT the empty envelope) never destroys a pinned match', async () => {
    const g = await seedGame('Palworld', 1623730);
    // Simulate a prior successful sync + pin.
    await testApp.db
      .update(schema.games)
      .set({
        cooptimusId: 9814,
        cooptimusOnlineMax: 32,
        cooptimusSyncedAt: new Date('2020-01-01'),
      })
      .where(eq(schema.games.id, g.id));
    // Challenge HTML / truncated body: parses to zero entries, empty=false.
    const byIdMock = jest
      .spyOn(cooptimus, 'searchById')
      .mockResolvedValue({ entries: [], empty: false });
    mockLookup({ entries: [], empty: false });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: 9814,
    });

    expect(outcome).toBe('failed');
    const after = await reload(g.id);
    expect(after.cooptimusId).toBe(9814); // pin preserved
    expect(after.cooptimusOnlineMax).toBe(32); // data preserved
    expect(byNameMock).not.toHaveBeenCalled(); // no fall-through either
    byIdMock.mockRestore();
  });

  it('steam-id-grade hit from the base-title fallback query auto-applies', async () => {
    const g = await seedGame('Mortal Kombat 11: Ultimate', 976310);
    byNameMock = jest
      .spyOn(cooptimus, 'searchByName')
      .mockResolvedValueOnce({ entries: [], empty: true })
      .mockResolvedValueOnce({
        entries: [entry({ id: 555, title: 'Mortal Kombat 11', steam: 976310 })],
        empty: false,
      });

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: g.steamAppId,
      cooptimusId: null,
    });

    expect(outcome).toBe('synced'); // arbiter-grade evidence, not review
    const after = await reload(g.id);
    expect(after.cooptimusId).toBe(555);
  });

  it('garbage 200 on the BASE-title query is a transient failure, not no-entry (Codex P2)', async () => {
    const g = await seedGame('Mortal Kombat 11: Ultimate');
    byNameMock = jest
      .spyOn(cooptimus, 'searchByName')
      .mockResolvedValueOnce({ entries: [], empty: true }) // full name: positive miss
      .mockResolvedValueOnce({ entries: [], empty: false }); // base query: garbage 200

    const outcome = await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: null,
    });

    expect(outcome).toBe('failed');
    const after = await reload(g.id);
    expect(after.cooptimusSyncedAt).toBeNull(); // untouched — retried next run
    expect(after.cooptimusOnlineMax).toBeNull(); // never zeroed
  });

  it('review queue dedups by gameId across repeated cycles', async () => {
    const g = await seedGame('Sonic Mania Plus');
    const missThenBase = () =>
      jest
        .spyOn(cooptimus, 'searchByName')
        .mockResolvedValueOnce({ entries: [], empty: true })
        .mockResolvedValueOnce({
          entries: [entry({ id: 777, title: 'Sonic Mania' })],
          empty: false,
        });

    byNameMock = missThenBase();
    await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: null,
    });
    byNameMock.mockRestore();
    byNameMock = missThenBase();
    await sync.syncGame({
      id: g.id,
      name: g.name,
      steamAppId: null,
      cooptimusId: null,
    });

    const queue = await sync.getReviewQueue();
    const forGame = queue.filter(
      (raw) => (JSON.parse(raw) as { gameId: number }).gameId === g.id,
    );
    expect(forGame).toHaveLength(1);
  });

  it('runSync scans only visible never-synced/stale rows and honors the batch abort', async () => {
    const fresh = await seedGame('Fresh Game');
    await testApp.db
      .update(schema.games)
      .set({ cooptimusSyncedAt: new Date() })
      .where(eq(schema.games.id, fresh.id));
    const hiddenGame = await seedGame('Hidden Game');
    await testApp.db
      .update(schema.games)
      .set({ hidden: true })
      .where(eq(schema.games.id, hiddenGame.id));
    const stale = await seedGame('Stale Game');
    await testApp.db
      .update(schema.games)
      .set({ cooptimusSyncedAt: new Date('2020-01-01') })
      .where(eq(schema.games.id, stale.id));
    // Enough never-synced rows that all-failing transport trips the
    // 5-consecutive-failure abort deterministically.
    for (let i = 0; i < 5; i++) await seedGame(`Never Synced ${i}`);

    // Transport-level failure for every scanned row → exercises the scan
    // predicate (fresh + hidden excluded) AND the batch abort.
    mockLookup(null);
    const summary = await sync.runSync();

    const scannedNames = byNameMock.mock.calls.map((c) => c[0] as string);
    expect(scannedNames).not.toContain('Fresh Game');
    expect(scannedNames).not.toContain('Hidden Game');
    expect(scannedNames).toHaveLength(5); // aborted after 5 consecutive
    expect(summary.aborted).toBe(true);
    expect(summary.failed).toBe(5);
    expect(summary.synced).toBe(0);
    // Stale + never-synced rows WERE selected (scanned ≥ the 7 eligible).
    expect(summary.scanned).toBeGreaterThanOrEqual(7);
  });

  it('pinned cooptimus_id re-syncs by id without a name search', async () => {
    const g = await seedGame('Some Renamed Game');
    const byIdMock = jest.spyOn(cooptimus, 'searchById').mockResolvedValue({
      entries: [entry({ id: 4242, online: 6 })],
      empty: false,
    });
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
