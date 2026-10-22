/**
 * ROK-1873 (ROK-1428 L11, A1, A8/D8) — the `hub` activity signal and the
 * community-hub hold, real DB.
 *
 * WHY INTEGRATION: both read GREATEST() over correlated sub-selects on
 * `hub_posts`, `hub_community_members` and tagged `events` — not mockable.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from '../../guilds/community/community-proposals.queries';
import { decideGame } from './channel-lifecycle.decide';
import { selectGameLifecycleActivity } from './game-activity.queries';
import { DEFAULT_SIGNALS } from './game-activity.signals';
import {
  holdWindow,
  hubSignal,
  selectHubHoldGameIds,
} from './hub-activity.signal';

const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);
const SETTINGS = { createThreshold: 2, recentActivityDays: 30 };

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function makeGame(): Promise<number> {
  seq += 1;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: `L11 Game ${seq}`, slug: `l11-${seq}-${Date.now()}` })
      .returning({ id: schema.games.id }),
    'game',
  );
  return g.id;
}

type HubStatus = 'proposed' | 'active' | 'archived';

/** A community hub whose proposal + approval both happened `days` ago. */
async function makeHub(
  gameId: number,
  status: HubStatus,
  days = 0,
): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId,
    name: `L11 Hub ${(seq += 1)}`,
    blurb: '',
    status: status === 'archived' ? 'active' : status,
    proposedBy: testApp.seed.adminUser.id,
    reviewedBy: status === 'proposed' ? null : testApp.seed.adminUser.id,
  });
  const when = ago(days);
  await testApp.db
    .update(schema.guilds)
    .set({
      status,
      createdAt: when,
      reviewedAt: status === 'proposed' ? null : when,
      ...(status === 'archived' ? { archivedAt: when } : {}),
    })
    .where(eq(schema.guilds.id, hub.id));
  return hub.id;
}

async function rowFor(gameId: number) {
  const holds = await selectHubHoldGameIds(testApp.db, holdWindow(NOW, 30));
  const rows = await selectGameLifecycleActivity(testApp.db, {
    now: NOW,
    windowDays: 30,
    signals: [...DEFAULT_SIGNALS, hubSignal],
    gameIds: [gameId],
    hubHoldGameIds: holds,
  });
  return { holds, row: rows.find((r) => r.gameId === gameId) };
}

describe('community-hub signal + hold (ROK-1873)', () => {
  it('an approved hub is one `hub` item and holds → create (X2)', async () => {
    const gameId = await makeGame();
    await makeHub(gameId, 'active');
    const { holds, row } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(true);
    const hub = row?.signals.find((s) => s.kind === 'hub');
    expect(hub?.itemCount).toBe(1);
    expect(row && decideGame(row, SETTINGS).action).toBe('create');
  });

  it('a proposal counts as an item but never holds → none (X3)', async () => {
    const gameId = await makeGame();
    await makeHub(gameId, 'proposed');
    const { holds, row } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(false);
    expect(row?.itemCount).toBe(1);
    expect(row && decideGame(row, SETTINGS).action).toBe('none');
  });

  it('an archived hub neither counts nor holds', async () => {
    const gameId = await makeGame();
    await makeHub(gameId, 'archived');
    const { holds, row } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(false);
    expect(row?.itemCount ?? 0).toBe(0);
  });
});

describe('community-hub hold release + revival (ROK-1873 D8)', () => {
  it('a hidden active hub releases the hold', async () => {
    const gameId = await makeGame();
    const hubId = await makeHub(gameId, 'active');
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: NOW })
      .where(eq(schema.guilds.id, hubId));
    const { holds } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(false);
  });

  it('a hub quiet for > 30 days is dormant: no hold, no item', async () => {
    const gameId = await makeGame();
    await makeHub(gameId, 'active', 40);
    const { holds, row } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(false);
    expect(row?.itemCount ?? 0).toBe(0);
  });

  it('a recent leader post revives a dormant hub (item + hold)', async () => {
    const gameId = await makeGame();
    const hubId = await makeHub(gameId, 'active', 40);
    await testApp.db.insert(schema.hubPosts).values({
      guildId: hubId,
      body: 'Raid night is back',
      authorId: testApp.seed.adminUser.id,
      createdAt: ago(2),
    });
    const { holds, row } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(true);
    expect(row?.signals.find((s) => s.kind === 'hub')?.itemCount).toBe(1);
  });

  it('a recent member join revives a dormant hub', async () => {
    const gameId = await makeGame();
    const hubId = await makeHub(gameId, 'active', 40);
    await testApp.db
      .update(schema.hubCommunityMembers)
      .set({ joinedAt: ago(1) })
      .where(eq(schema.hubCommunityMembers.guildId, hubId));
    const { holds } = await rowFor(gameId);
    expect(holds.has(gameId)).toBe(true);
  });

  it('two hubs on one game are two hub items', async () => {
    const gameId = await makeGame();
    await makeHub(gameId, 'active');
    await makeHub(gameId, 'proposed');
    const { row } = await rowFor(gameId);
    expect(row?.signals.find((s) => s.kind === 'hub')?.itemCount).toBe(2);
  });
});
