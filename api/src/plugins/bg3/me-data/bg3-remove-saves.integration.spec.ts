/**
 * ROK-2068 — `POST plugins/bg3/me/saves/remove` against a real database:
 * 401 / 400s, caller-only + key-only deletes (user B shares key and sha),
 * the removed keys' bindings go while default + claim stay, thumbnail refs
 * and Gallery pictures go only for shas no kept save uses, bg3 INACTIVE
 * still works, a repeat answers zeros, the removed keys' latest-wins markers
 * are CLEARED (operator ruling 2026-11-03: a re-sent save is accepted), the
 * lock order holds against an in-flight ingest, and unbinding a key still
 * deletes no saves. Every test makes its own users + hub; no afterAll DB
 * work (the shared setup closes the pool).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { waitFor } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import * as hubMediaRepo from '../../../hub-media/hub-media.repository';
import { CompanionIngestLatestRepository } from '../../../companion/ingest/companion-ingest-latest.repository';
import {
  bearer,
  expireLimiterWindows,
} from '../../../companion/devices/testing/companion-link.helpers';
import type { CompanionDeviceTx } from '../../../companion/devices/companion-device-lock';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { lockBg3UserCampaigns } from '../campaigns/bg3-campaign-lock';
import { bg3LatestMarkerKey } from '../ingest/bg3-save.handler';
import { Bg3RemoveSavesRepository } from './bg3-remove-saves.repository';

const URL = '/plugins/bg3/me/saves/remove';
const HOUR = 3_600_000;
const OLD = 'a1'.repeat(32);
const OLD2 = 'a2'.repeat(32);
const KEEP = 'b1'.repeat(32);
const SHA_SHARED = '1a'.repeat(32);
const SHA_GONE = '2b'.repeat(32);
const T0 = new Date('2026-10-24T12:00:00Z');
const ZERO = {
  saves: 0,
  campaignKeys: 0,
  thumbnailRefs: 0,
  galleryPictures: 0,
};

let testApp: TestApp;
let bg3GameId = 0;
let seq = 0;
const registry = () => testApp.app.get(PluginRegistryService);
const latest = () => testApp.app.get(CompanionIngestLatestRepository);

beforeAll(async () => {
  testApp = await getTestApp();
  const g = schema.games;
  await testApp.db
    .insert(g)
    .values({ name: "Baldur's Gate 3", slug: BG3_GAME_SLUG })
    .onConflictDoNothing();
  const found = await testApp.db
    .select({ id: g.id })
    .from(g)
    .where(eq(g.slug, BG3_GAME_SLUG));
  bg3GameId = nonEmpty(found, 'bg3 game')[0].id;
});

beforeEach(async () => {
  await registry().ensureInstalled(BG3_PLUGIN_ID);
  await registry().activate(BG3_PLUGIN_ID);
});

afterEach(async () => {
  if (registry().isActive(BG3_PLUGIN_ID))
    await registry().deactivate(BG3_PLUGIN_ID);
});

// ── seeding ────────────────────────────────────────────────────────────────

async function makeUser(tag: string): Promise<{ id: number; token: string }> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:bg3rm-${tag}-${seq}@bg3-remove-saves.test`,
        username: `bg3rm-${tag}-${seq}`,
        role: 'member',
      })
      .returning(),
    `user ${tag}`,
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: u.username,
    role: 'member',
  });
  return { id: u.id, token };
}

async function makeHubAndCampaign(
  hostUserId: number,
): Promise<{ hubId: number; campaignId: number }> {
  seq += 1;
  const name = `BG3 Remove Saves Hub ${seq}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: bg3GameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        status: 'active',
        name,
        nameKey: name.toLowerCase(),
        lastSnapshotAt: new Date(),
      })
      .returning(),
    'hub',
  );
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({
        guildId: g.id,
        name: 'Run',
        hostUserId,
        createdByUserId: hostUserId,
      })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  return { hubId: g.id, campaignId: c.id };
}

async function insertSave(
  userId: number,
  campaignKey: string,
  minute: number,
  sha: string | null,
  campaignId: number | null = null,
): Promise<void> {
  const savedAt = new Date(T0.getTime() + minute * 60_000);
  await testApp.db.insert(schema.bg3Saves).values({
    uploaderUserId: userId,
    campaignId,
    campaignKey,
    campaignKeySource: 'save-folder',
    saveName: `Save ${minute}`,
    savedAt,
    capturedAt: savedAt,
    gameVersion: '4.1.1.7631656',
    platform: 'Steam',
    currentLevel: 'SCL_Main_A',
    difficulty: 'DifficultyHard',
    ruleset: null,
    party: [],
    partyMaxLevel: 1,
    thumbnailSha256: sha,
    thumbnailWidth: sha === null ? null : 1280,
    thumbnailHeight: sha === null ? null : 720,
  });
}

async function insertRef(userId: number, sha256: string): Promise<void> {
  await testApp.db.insert(schema.companionBlobRefs).values({
    userId,
    sha256,
    contract: BG3_SAVE_CONTRACT_ID,
    byteLength: 1698,
    width: 1280,
    height: 720,
    referencedAt: new Date(Date.now() - HOUR),
  });
}

async function insertPicture(
  hubId: number,
  userId: number,
  sha: string,
): Promise<void> {
  await testApp.db.insert(schema.hubMedia).values({
    guildId: hubId,
    source: 'bg3-save',
    kind: 'screenshot',
    provenanceKey: `bg3-save:sha256:${sha}`,
    authorName: `u${userId}`,
    caption: 'Act 1',
    capturedAt: T0,
    storageName: randomUUID(),
    width: 1280,
    height: 720,
    bytes: 1000,
    uploadedBy: userId,
  });
}

const advance = (userId: number, key: string, at = T0) =>
  latest().transaction((tx) =>
    latest().advance(tx, { userId, contract: BG3_SAVE_CONTRACT_ID, key, at }),
  );

/**
 * A: OLD (2 saves: SHA_SHARED, SHA_GONE; bound), OLD2 (1 save, no sha),
 * KEEP (1 save on SHA_SHARED; bound), default + claim, refs on both shas,
 * Gallery pictures of both shas, markers for OLD and KEEP. B: an OLD save on
 * SHA_GONE with its own binding, ref, marker and (in hub B) picture.
 */
async function seedWorld() {
  const a = await makeUser('a');
  const b = await makeUser('b');
  const { hubId, campaignId } = await makeHubAndCampaign(a.id);
  // A hub's provenance key is unique (twins collapse), so B's picture of
  // SHA_GONE lives in another hub.
  const { hubId: hubB } = await makeHubAndCampaign(b.id);
  await insertSave(a.id, OLD, 0, SHA_SHARED, campaignId);
  await insertSave(a.id, OLD, 1, SHA_GONE, campaignId);
  await insertSave(a.id, OLD2, 2, null);
  await insertSave(a.id, KEEP, 3, SHA_SHARED, campaignId);
  await insertSave(b.id, OLD, 0, SHA_GONE, campaignId);
  for (const [userId, campaignKey] of [
    [a.id, OLD],
    [a.id, KEEP],
    [b.id, OLD],
  ] as const)
    await testApp.db
      .insert(schema.bg3CampaignKeys)
      .values({ userId, campaignKey, campaignId });
  await testApp.db
    .insert(schema.bg3UserDefaults)
    .values({ userId: a.id, campaignId });
  await testApp.db
    .insert(schema.bg3PartyClaims)
    .values({ userId: a.id, campaignId, slotKey: 'Generic:Human:1' });
  for (const [userId, sha] of [
    [a.id, SHA_SHARED],
    [a.id, SHA_GONE],
    [b.id, SHA_GONE],
  ] as const) {
    await insertRef(userId, sha);
    await insertPicture(userId === b.id ? hubB : hubId, userId, sha);
  }
  for (const [userId, key] of [
    [a.id, OLD],
    [a.id, KEEP],
    [b.id, OLD],
  ] as const)
    expect(await advance(userId, key)).toBe(true);
  return { a, b, hubId, hubB, campaignId };
}

// ── reads ──────────────────────────────────────────────────────────────────

interface Counts extends Record<string, unknown> {
  saves: number;
  keys: number;
  defaults: number;
  claims: number;
}

async function counts(userId: number): Promise<Counts> {
  const rows = await testApp.db.execute<Counts>(sql`SELECT
    (SELECT count(*)::int FROM bg3_saves WHERE uploader_user_id = ${userId}) AS "saves",
    (SELECT count(*)::int FROM bg3_campaign_keys WHERE user_id = ${userId}) AS "keys",
    (SELECT count(*)::int FROM bg3_user_defaults WHERE user_id = ${userId}) AS "defaults",
    (SELECT count(*)::int FROM bg3_party_claims WHERE user_id = ${userId}) AS "claims"`);
  return { ...nonEmpty(rows, 'counts')[0] };
}

async function savesByKey(userId: number): Promise<string[]> {
  const s = schema.bg3Saves;
  const rows = await testApp.db
    .select({ key: s.campaignKey })
    .from(s)
    .where(eq(s.uploaderUserId, userId));
  return rows.map((r) => r.key.slice(0, 4)).sort();
}

async function refShas(userId: number): Promise<string[]> {
  const r = schema.companionBlobRefs;
  const rows = await testApp.db
    .select({ sha: r.sha256 })
    .from(r)
    .where(and(eq(r.userId, userId), eq(r.contract, BG3_SAVE_CONTRACT_ID)));
  return rows.map((x) => x.sha.slice(0, 4)).sort();
}

/** `sha-prefix:live|gone` of the user's pictures (tombstones are scrubbed). */
async function pictures(hubId: number): Promise<string[]> {
  const m = schema.hubMedia;
  const rows = await testApp.db
    .select({ key: m.provenanceKey, by: m.uploadedBy, removedAt: m.removedAt })
    .from(m)
    .where(eq(m.guildId, hubId));
  return rows
    .map((r) => {
      const sha = r.key.replace('bg3-save:sha256:', '').slice(0, 4);
      return `${sha}:${r.removedAt === null ? `live:${r.by}` : `gone:${r.by}`}`;
    })
    .sort();
}

const post = (token: string, body: unknown) =>
  testApp.request
    .post(URL)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

// ── tests ──────────────────────────────────────────────────────────────────

describe('POST plugins/bg3/me/saves/remove — auth and body', () => {
  it('no JWT → 401', async () => {
    const res = await testApp.request.post(URL).send({ campaignKeys: [OLD] });
    expect(res.status).toBe(401);
  });

  it.each([
    ['an empty array', { campaignKeys: [] }],
    ['a non-hex key', { campaignKeys: ['zz'.repeat(32)] }],
    ['a short key', { campaignKeys: ['ab'] }],
    ['an uppercase-hex key', { campaignKeys: ['A1'.repeat(32)] }],
    ['an extra field', { campaignKeys: [OLD], all: true }],
    ['501 keys', { campaignKeys: Array.from({ length: 501 }, () => OLD) }],
  ])('400 on %s, nothing removed', async (_label, body) => {
    const { a } = await seedWorld();
    expect((await post(a.token, body)).status).toBe(400);
    expect((await counts(a.id)).saves).toBe(4);
  });
});

describe('POST plugins/bg3/me/saves/remove — what goes and what stays', () => {
  it("removes only the caller's saves for those keys, their bindings, unused refs and pictures", async () => {
    const { a, b, hubId, hubB } = await seedWorld();

    const res = await post(a.token, { campaignKeys: [OLD, OLD2, OLD] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      removed: {
        saves: 3,
        campaignKeys: 1,
        thumbnailRefs: 1,
        galleryPictures: 1,
      },
    });
    // KEEP stays with its binding; default + claim are not per key (D-5).
    expect(await savesByKey(a.id)).toEqual([KEEP.slice(0, 4)]);
    expect(await counts(a.id)).toEqual({
      saves: 1,
      keys: 1,
      defaults: 1,
      claims: 1,
    });
    // SHA_SHARED is still KEEP's thumbnail: its ref and picture survive.
    expect(await refShas(a.id)).toEqual([SHA_SHARED.slice(0, 4)]);
    expect(await pictures(hubId)).toEqual(
      [
        `${SHA_SHARED.slice(0, 4)}:live:${a.id}`,
        `${SHA_GONE.slice(0, 4)}:gone:null`,
      ].sort(),
    );
    expect(await pictures(hubB)).toEqual([
      `${SHA_GONE.slice(0, 4)}:live:${b.id}`,
    ]);
    // B shares the OLD key and SHA_GONE: untouched.
    expect(await counts(b.id)).toEqual({
      saves: 1,
      keys: 1,
      defaults: 0,
      claims: 0,
    });
    expect(await refShas(b.id)).toEqual([SHA_GONE.slice(0, 4)]);
  });

  it('works with bg3 INACTIVE; a repeat or an unknown key answers zeros', async () => {
    const { a } = await seedWorld();
    await registry().deactivate(BG3_PLUGIN_ID);

    expect((await post(a.token, { campaignKeys: [OLD] })).status).toBe(200);
    expect(await savesByKey(a.id)).toEqual(
      [OLD2.slice(0, 4), KEEP.slice(0, 4)].sort(),
    );
    const again = await post(a.token, { campaignKeys: [OLD, 'ff'.repeat(32)] });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ removed: ZERO });
  });
});

// ── latest-wins markers: real ingest (ROK-2070 B1: one marker per save) ────

const MESSAGES = `/companion/v1/messages/${BG3_SAVE_CONTRACT_ID}`;
const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
      ),
      'utf8',
    ),
  ) as unknown,
);

/**
 * The act2 fixture under `campaignKey`; another `savedAt` = another save.
 * `capturedAt` must not precede `savedAt`, so it is pinned after both.
 */
function act2(campaignKey: string, savedAt = ACT2.payload.savedAt) {
  const capturedAt = '2026-10-25T00:00:00Z';
  return {
    ...ACT2,
    capturedAt,
    payload: { ...ACT2.payload, campaignKey, savedAt },
  };
}

async function ingestAck(token: string, msg: Bg3SaveMessage): Promise<unknown> {
  const res = await testApp.request
    .post(MESSAGES)
    .set('Content-Type', 'application/json')
    .set(bearer(token))
    .serialize((bytes) => bytes)
    .send(Buffer.from(JSON.stringify(msg)));
  return [res.status, res.body];
}

const accepted = [202, { status: 'accepted' }];
const stale = [202, { status: 'stale' }];

async function markerKeys(userId: number): Promise<string[]> {
  const m = schema.companionIngestLatest;
  const rows = await testApp.db
    .select({ key: m.latestKey })
    .from(m)
    .where(and(eq(m.userId, userId), eq(m.contract, BG3_SAVE_CONTRACT_ID)));
  return rows.map((r) => r.key).sort();
}

describe('POST plugins/bg3/me/saves/remove — latest-wins markers (Q3: cleared)', () => {
  beforeEach(() => expireLimiterWindows(testApp));

  it('a re-sent removed save is accepted again (per-save marker); kept keys and other users stay stale', async () => {
    const a = await makeUser('resend');
    const b = await makeUser('resend-b');
    const keepMsg = act2(KEEP, '2026-10-24T13:00:00Z');
    expect(await ingestAck(a.token, act2(OLD))).toEqual(accepted);
    expect(await ingestAck(a.token, keepMsg)).toEqual(accepted);
    expect(await ingestAck(b.token, act2(OLD))).toEqual(accepted);
    expect(await ingestAck(a.token, act2(OLD))).toEqual(stale);
    const perSave = bg3LatestMarkerKey(OLD, ACT2.payload.saveName);
    expect(await markerKeys(a.id)).toContain(perSave);

    expect((await post(a.token, { campaignKeys: [OLD] })).status).toBe(200);

    expect(await markerKeys(a.id)).not.toContain(perSave);
    expect(await ingestAck(a.token, act2(OLD))).toEqual(accepted);
    expect(await savesByKey(a.id)).toEqual(
      [OLD.slice(0, 4), KEEP.slice(0, 4)].sort(),
    );
    expect(await ingestAck(a.token, keepMsg)).toEqual(stale);
    expect(await ingestAck(b.token, act2(OLD))).toEqual(stale);
  });

  it('a legacy bare-key marker is cleared too: the re-send after the remove is accepted', async () => {
    const a = await makeUser('legacy');
    expect(await ingestAck(a.token, act2(OLD))).toEqual(accepted);
    // A pre-B1 marker on the bare campaign key, as old data still holds.
    expect(await advance(a.id, OLD, new Date(ACT2.payload.savedAt))).toBe(true);

    expect((await post(a.token, { campaignKeys: [OLD] })).status).toBe(200);

    expect(await markerKeys(a.id)).toEqual([]);
    expect(await ingestAck(a.token, act2(OLD))).toEqual(accepted);
    expect(await savesByKey(a.id)).toEqual([OLD.slice(0, 4)]);
  });
});

describe('POST plugins/bg3/me/saves/remove — a failed Gallery cleanup is retryable (review P2-1)', () => {
  it('a forced tombstone failure keeps every save and picture; the retry removes both', async () => {
    const { a, hubId } = await seedWorld();
    const all = [OLD, OLD, OLD2, KEEP].map((k) => k.slice(0, 4)).sort();
    const live = [
      `${SHA_SHARED.slice(0, 4)}:live:${a.id}`,
      `${SHA_GONE.slice(0, 4)}:live:${a.id}`,
    ].sort();
    const spy = jest
      .spyOn(hubMediaRepo, 'tombstoneSourceRowsByKeys')
      .mockRejectedValueOnce(new Error('forced Gallery cleanup failure'));
    try {
      expect((await post(a.token, { campaignKeys: [OLD] })).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    // The tombstone failed, so the whole removal rolled back.
    expect(await savesByKey(a.id)).toEqual(all);
    expect(await pictures(hubId)).toEqual(live);

    const retry = await post(a.token, { campaignKeys: [OLD] });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({
      removed: {
        saves: 2,
        campaignKeys: 1,
        thumbnailRefs: 1,
        galleryPictures: 1,
      },
    });
    expect(await pictures(hubId)).toEqual(
      [
        `${SHA_SHARED.slice(0, 4)}:live:${a.id}`,
        `${SHA_GONE.slice(0, 4)}:gone:null`,
      ].sort(),
    );
  });
});

describe('unbinding a key never deletes saves (D-8)', () => {
  it('DELETE me/campaign-keys/:key leaves bg3_saves unchanged', async () => {
    const { a } = await seedWorld();
    const res = await testApp.request
      .delete(`/plugins/bg3/me/campaign-keys/${OLD}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);
    expect(await counts(a.id)).toMatchObject({ saves: 4, keys: 1 });
  });
});

// ── lock order vs an in-flight ingest (mirrors bg3-my-data F5b) ─────────────

async function backendPid(tx: CompanionDeviceTx): Promise<number> {
  const [row] = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid`,
  );
  if (!row) throw new Error('pg_backend_pid() returned no row');
  return row.pid;
}

async function rowWaitersBlockedBy(blockerPid: number): Promise<number> {
  const rows = await testApp.db.execute<{ n: number }>(sql`
    select count(*)::int as n from pg_locks
    where not granted and locktype in ('transactionid', 'tuple')
      and ${blockerPid}::int = any(pg_blocking_pids(pid))`);
  return rows[0]?.n ?? 0;
}

function outcome(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'ok',
    (e: unknown) => {
      const err = e as { message?: string; cause?: { message?: string } };
      return `rejected: ${err.cause?.message ?? err.message ?? String(e)}`;
    },
  );
}

describe('Bg3RemoveSavesRepository.removeKeysFor — lock order vs ingest (F5b)', () => {
  it('an ingest holding its marker row then taking the campaign lock does not deadlock the removal', async () => {
    const a = await makeUser('lockorder');
    expect(await advance(a.id, OLD)).toBe(true);
    let removed: Promise<string> = Promise.resolve('removal never started');
    const ingested = outcome(
      latest().transaction(async (tx) => {
        const pid = await backendPid(tx);
        const later = new Date(T0.getTime() + HOUR);
        const row = { userId: a.id, contract: BG3_SAVE_CONTRACT_ID };
        expect(
          await latest().advance(tx, { ...row, key: OLD, at: later }),
        ).toBe(true);
        removed = outcome(
          testApp.app.get(Bg3RemoveSavesRepository).removeKeysFor(a.id, [OLD]),
        );
        await waitFor(
          async () => expect(await rowWaitersBlockedBy(pid)).toBeGreaterThan(0),
          10_000,
          20,
        );
        await lockBg3UserCampaigns(tx, a.id);
      }),
    );
    expect([await ingested, await removed]).toEqual(['ok', 'ok']);
    const m = schema.companionIngestLatest;
    const left = await testApp.db
      .select({ key: m.latestKey })
      .from(m)
      .where(and(eq(m.userId, a.id), eq(m.contract, BG3_SAVE_CONTRACT_ID)));
    expect(left).toEqual([]);
  });
});
