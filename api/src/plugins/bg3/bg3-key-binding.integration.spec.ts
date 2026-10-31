/**
 * ROK-1960 F4 — the cross-hub guard on `PUT /plugins/bg3/me/campaign-keys/:key`
 * against a real DB. A bind moves EVERY one of the caller's saves with the
 * key, and those can sit in several hubs, so a bind that would move any of
 * them (or the binding) out of another hub 409s `cross_hub_move` and moves
 * nothing unless `confirmCrossHub: true`. Hubs the caller can no longer read
 * are redacted. Conventions follow `bg3-archive.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3CampaignSummarySchema,
  Bg3CrossHubMoveSchema,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  makeUser,
} from '../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { waitFor } from '../../common/testing/integration-helpers';
import {
  bg3CampaignLockKey,
  lockBg3UserCampaigns,
} from './campaigns/bg3-campaign-lock';

const MESSAGES = `/companion/v1/messages/${BG3_SAVE_CONTRACT_ID}`;
const BG3 = '/plugins/bg3';
const FIXTURE = join(
  __dirname,
  '../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
);
const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown,
);
const KEY_A = ACT2.payload.campaignKey;
const CAPTURED = '2026-10-25T00:00:00Z';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function save(key: string, savedAt: string): Bg3SaveMessage {
  return {
    ...ACT2,
    capturedAt: CAPTURED,
    payload: { ...ACT2.payload, savedAt, campaignKey: key },
  };
}

async function ingest(token: string, msg: Bg3SaveMessage): Promise<void> {
  const res = await testApp.request
    .post(MESSAGES)
    .set('Content-Type', 'application/json')
    .set(bearer(token))
    .serialize((bytes) => bytes)
    .send(Buffer.from(JSON.stringify(msg)));
  expect([res.status, res.body]).toEqual([202, { status: 'accepted' }]);
}

async function bg3GameId(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, BG3_GAME_SLUG));
  if (found) return found.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: "Baldur's Gate 3", slug: BG3_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'bg3 game',
  );
  return game.id;
}

async function insertHub(name = 'BG3 Crew'): Promise<number> {
  const gameId = await bg3GameId();
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return hub.id;
}

async function joinHub(
  guildId: number,
  userId: number,
  role: 'member' | 'officer' = 'member',
): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role });
}

async function createCampaign(token: string, hubId: number, name: string) {
  const res = await testApp.request
    .post(`${BG3}/hubs/${hubId}/campaigns`)
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return Bg3CampaignSummarySchema.parse(res.body).id;
}

async function put(token: string, path: string, body: object) {
  return testApp.request.put(`${BG3}${path}`).set(bearer(token)).send(body);
}

const keyPath = `/me/campaign-keys/${KEY_A}`;

async function bind(token: string, campaignId: number, confirm?: true) {
  const body = confirm ? { campaignId, confirmCrossHub: true } : { campaignId };
  return put(token, keyPath, body);
}

async function setDefault(token: string, campaignId: number): Promise<void> {
  const res = await put(token, '/me/default-campaign', { campaignId });
  expect(res.status).toBe(204);
}

/** The uploader's saves with KEY_A, oldest first, as their campaign ids. */
async function filedIn(userId: number): Promise<(number | null)[]> {
  const s = schema.bg3Saves;
  const rows = await testApp.db
    .select({ campaignId: s.campaignId })
    .from(s)
    .where(and(eq(s.uploaderUserId, userId), eq(s.campaignKey, KEY_A)))
    .orderBy(s.savedAt);
  return rows.map((r) => r.campaignId);
}

async function boundTo(userId: number): Promise<number | null> {
  const k = schema.bg3CampaignKeys;
  const [row] = await testApp.db
    .select({ campaignId: k.campaignId })
    .from(k)
    .where(and(eq(k.userId, userId), eq(k.campaignKey, KEY_A)));
  return row?.campaignId ?? null;
}

/** The host is in hub A ("Act Two") and hub B ("Act Three"). */
async function twoHubs() {
  const hubA = await insertHub('BG3 Crew');
  const hubB = await insertHub('Other Crew');
  const host = await makeUser(testApp, 'bg3-host');
  await joinHub(hubA, host.id);
  await joinHub(hubB, host.id);
  const inA = await createCampaign(host.token, hubA, 'Act Two');
  const inB = await createCampaign(host.token, hubB, 'Act Three');
  return { hubA, hubB, host, inA, inB };
}

/** Older save filed in A, newer in B (the default only files unassigned rows). */
async function splitSaves(w: Awaited<ReturnType<typeof twoHubs>>) {
  await setDefault(w.host.token, w.inA);
  await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
  await setDefault(w.host.token, w.inB);
  await ingest(w.host.token, save(KEY_A, '2026-10-24T21:00:00Z'));
  expect(await filedIn(w.host.id)).toEqual([w.inA, w.inB]);
}

describe('PUT me/campaign-keys/:key — cross-hub guard', () => {
  it('409s a bind in B while an older save sits in A, and moves nothing', async () => {
    const w = await twoHubs();
    await splitSaves(w);
    const res = await bind(w.host.token, w.inB);
    expect([res.status, res.body]).toEqual([
      409,
      {
        code: 'cross_hub_move',
        saveCount: 1,
        locations: [
          {
            campaignId: w.inA,
            campaignName: 'Act Two',
            hubId: w.hubA,
            hubName: 'BG3 Crew',
          },
        ],
      },
    ]);
    expect(Bg3CrossHubMoveSchema.safeParse(res.body).success).toBe(true);
    expect(await filedIn(w.host.id)).toEqual([w.inA, w.inB]);
    expect(await boundTo(w.host.id)).toBeNull();
  });

  it('with confirmCrossHub, binds and moves every save', async () => {
    const w = await twoHubs();
    await splitSaves(w);
    const res = await bind(w.host.token, w.inB, true);
    expect(res.status).toBe(204);
    expect(await filedIn(w.host.id)).toEqual([w.inB, w.inB]);
    expect(await boundTo(w.host.id)).toBe(w.inB);
  });

  it('409s when the binding points into A even though the latest save is in B', async () => {
    const w = await twoHubs();
    await setDefault(w.host.token, w.inB);
    await ingest(w.host.token, save(KEY_A, '2026-10-24T21:00:00Z'));
    await testApp.db
      .insert(schema.bg3CampaignKeys)
      .values({ userId: w.host.id, campaignKey: KEY_A, campaignId: w.inA });
    const res = await bind(w.host.token, w.inB);
    expect([res.status, res.body]).toEqual([
      409,
      {
        code: 'cross_hub_move',
        saveCount: 0,
        locations: [
          {
            campaignId: w.inA,
            campaignName: 'Act Two',
            hubId: w.hubA,
            hubName: 'BG3 Crew',
          },
        ],
      },
    ]);
    expect(await boundTo(w.host.id)).toBe(w.inA);
  });

  it('redacts a hub the caller has left (409, nulls, nothing moved)', async () => {
    const w = await twoHubs();
    await splitSaves(w);
    const m = schema.hubCommunityMembers;
    await testApp.db
      .delete(m)
      .where(and(eq(m.guildId, w.hubA), eq(m.userId, w.host.id)));
    const res = await bind(w.host.token, w.inB);
    expect([res.status, res.body]).toEqual([
      409,
      {
        code: 'cross_hub_move',
        saveCount: 1,
        locations: [
          { campaignId: null, campaignName: null, hubId: null, hubName: null },
        ],
      },
    ]);
    expect(await filedIn(w.host.id)).toEqual([w.inA, w.inB]);
  });
});

describe('PUT me/campaign-keys/:key — silent binds', () => {
  it('a same-hub move binds without asking', async () => {
    const w = await twoHubs();
    const alsoInA = await createCampaign(w.host.token, w.hubA, 'Act One');
    await setDefault(w.host.token, w.inA);
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    const res = await bind(w.host.token, alsoInA);
    expect(res.status).toBe(204);
    expect(await filedIn(w.host.id)).toEqual([alsoInA]);
    expect(await boundTo(w.host.id)).toBe(alsoInA);
  });

  it('an unbound key with no filed saves binds without asking', async () => {
    const w = await twoHubs();
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    expect(await filedIn(w.host.id)).toEqual([null]);
    const res = await bind(w.host.token, w.inB);
    expect(res.status).toBe(204);
    expect(await filedIn(w.host.id)).toEqual([w.inB]);
  });

  it('400s a non-boolean confirmCrossHub', async () => {
    const w = await twoHubs();
    const res = await put(w.host.token, keyPath, {
      campaignId: w.inB,
      confirmCrossHub: 'yes',
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROK-1960 F5 — one per-user lock serialises every campaign-filing writer
// ═══════════════════════════════════════════════════════════════════════════

type Tx = Parameters<Parameters<TestApp['db']['transaction']>[0]>[0];

/** Waiters queued on `userId`'s campaign lock (one-arg bigint key → classid/objid). */
async function lockWaiters(userId: number): Promise<number> {
  const key = bg3CampaignLockKey(userId);
  const rows = await testApp.db.execute<{ n: number }>(sql`
    select count(*)::int as n from pg_locks, hashtextextended(${key}, 0) as h
    where locktype = 'advisory' and not granted and objsubid = 1
      and classid::bigint = ((h >> 32) & 4294967295)
      and objid::bigint = (h & 4294967295)`);
  return rows[0]?.n ?? 0;
}

interface Tracked<T> {
  settled: boolean;
  done: Promise<T>;
}

function track<T>(started: PromiseLike<T>): Tracked<T> {
  const t: Tracked<T> = { settled: false, done: Promise.resolve(started) };
  t.done = t.done.finally(() => {
    t.settled = true;
  });
  return t;
}

/** Returns once the writer queues on the lock — or finishes, i.e. never took it. */
async function untilQueuedOrSettled(userId: number, t: Tracked<unknown>) {
  await waitFor(
    async () => {
      if (t.settled) return;
      expect(await lockWaiters(userId)).toBeGreaterThan(0);
    },
    10_000,
    20,
  );
}

/** Holds `userId`'s campaign lock in its own tx while `body` runs, then commits. */
async function holdingLock(userId: number, body: (tx: Tx) => Promise<void>) {
  await testApp.db.transaction(async (tx) => {
    await lockBg3UserCampaigns(tx, userId);
    await body(tx);
  });
}

/** What `setDefault` writes: the default, plus the user's unassigned rows. */
async function fileUnassigned(tx: Tx, userId: number, campaignId: number) {
  await tx.insert(schema.bg3UserDefaults).values({ userId, campaignId });
  const s = schema.bg3Saves;
  await tx
    .update(s)
    .set({ campaignId })
    .where(and(eq(s.uploaderUserId, userId), isNull(s.campaignId)));
}

describe('ROK-1960 F5 — per-user campaign lock', () => {
  // MUTATION: drop `lockBg3UserCampaigns` from `bindKey` — the bind then runs
  // its guard while the save is unassigned, binds 204 and moves the row into
  // B, and this fails on the status/body assertion (204, not 409).
  it('a bind queued behind a default change sees the newly filed save and 409s', async () => {
    const w = await twoHubs();
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    expect(await filedIn(w.host.id)).toEqual([null]);
    let bound: Tracked<{ status: number; body: unknown }> | undefined;
    await holdingLock(w.host.id, async (tx) => {
      const b = track(bind(w.host.token, w.inB).then((r) => r));
      bound = b;
      await untilQueuedOrSettled(w.host.id, b);
      await fileUnassigned(tx, w.host.id, w.inA);
    });
    if (!bound) throw new Error('bind never started');
    const res = await bound.done;
    expect([res.status, res.body]).toEqual([
      409,
      {
        code: 'cross_hub_move',
        saveCount: 1,
        locations: [
          {
            campaignId: w.inA,
            campaignName: 'Act Two',
            hubId: w.hubA,
            hubName: 'BG3 Crew',
          },
        ],
      },
    ]);
    expect(await filedIn(w.host.id)).toEqual([w.inA]);
    expect(await boundTo(w.host.id)).toBeNull();
  });

  type World = Awaited<ReturnType<typeof twoHubs>>;
  const writers: [string, (w: World) => PromiseLike<{ status: number }>][] = [
    [
      'setDefault',
      (w) => put(w.host.token, '/me/default-campaign', { campaignId: w.inA }),
    ],
    [
      'setDefault(null)',
      (w) => put(w.host.token, '/me/default-campaign', { campaignId: null }),
    ],
    [
      'unbind',
      (w) =>
        testApp.request.delete(`${BG3}${keyPath}`).set(bearer(w.host.token)),
    ],
    [
      'ingest',
      (w) =>
        testApp.request
          .post(MESSAGES)
          .set('Content-Type', 'application/json')
          .set(bearer(w.host.token))
          .serialize((bytes) => bytes)
          .send(
            Buffer.from(JSON.stringify(save(KEY_A, '2026-10-24T22:00:00Z'))),
          ),
    ],
  ];

  // MUTATION: drop `lockBg3UserCampaigns` from that writer and it finishes
  // while the lock is held — fails on `{ finishedWhileLocked: true }`.
  it.each(writers)(
    '%s waits for the per-user campaign lock',
    async (_name, run) => {
      const w = await twoHubs();
      let writer: Tracked<{ status: number }> | undefined;
      let finishedWhileLocked: boolean | undefined;
      await holdingLock(w.host.id, async () => {
        const t = track(run(w));
        writer = t;
        await untilQueuedOrSettled(w.host.id, t);
        finishedWhileLocked = t.settled;
      });
      expect({ finishedWhileLocked }).toEqual({ finishedWhileLocked: false });
      if (!writer) throw new Error('writer never started');
      expect([202, 204]).toContain((await writer.done).status);
    },
  );
});
