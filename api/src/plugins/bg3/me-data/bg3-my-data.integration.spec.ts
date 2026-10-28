/**
 * ROK-1957 §9.2 I-12 / D-18 — `DELETE plugins/bg3/me/data` against a real
 * database (HANDOVER-1957-L6b "L8b integration must assert"): 401 without a
 * JWT, 200 with bg3 INACTIVE, caller-only deletes while user B shares a sha
 * and the campaign, A's refs for other contracts (and never-bound blobs)
 * intact, a ref refreshed after the cutoff survives, a second call is all
 * zeros, and hosted campaigns survive.
 * Every test makes its own users + hub. No afterAll DB work: the shared setup
 * closes the pool.
 */
import { and, eq, sql } from 'drizzle-orm';
import { BG3_GAME_SLUG, BG3_SAVE_CONTRACT_ID } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import {
  Bg3MyDataRepository,
  type Bg3MyDataDeleted,
} from './bg3-my-data.repository';

const URL = '/plugins/bg3/me/data';
const HOUR = 3_600_000;
const KEY = 'cd'.repeat(32);
const SHA1 = '1a'.repeat(32);
const SHA_LOOSE = '2b'.repeat(32);
const SHA_FRESH = '3c'.repeat(32);
const OTHER_CONTRACT = 'valheim-world';
const T0 = new Date('2026-10-24T12:00:00Z');
const ZERO: Bg3MyDataDeleted = {
  saves: 0,
  campaignKeys: 0,
  defaultCampaign: 0,
  claims: 0,
  thumbnailRefs: 0,
};

let testApp: TestApp;
let bg3GameId = 0;
let seq = 0;

const registry = () => testApp.app.get(PluginRegistryService);

async function findOrCreateBg3Game(): Promise<number> {
  const g = schema.games;
  const game = { name: "Baldur's Gate 3", slug: BG3_GAME_SLUG };
  await testApp.db.insert(g).values(game).onConflictDoNothing();
  const found = await testApp.db
    .select({ id: g.id })
    .from(g)
    .where(eq(g.slug, BG3_GAME_SLUG));
  return nonEmpty(found, 'bg3 game')[0].id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  bg3GameId = await findOrCreateBg3Game();
});

beforeEach(async () => {
  await registry().ensureInstalled(BG3_PLUGIN_ID);
  await registry().activate(BG3_PLUGIN_ID);
});

afterEach(async () => {
  if (registry().isActive(BG3_PLUGIN_ID)) {
    await registry().deactivate(BG3_PLUGIN_ID);
  }
});

// ── seeding ────────────────────────────────────────────────────────────────

async function makeUser(tag: string): Promise<{ id: number; token: string }> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:bg3md-${tag}-${seq}@bg3-my-data.test`,
        username: `bg3md-${tag}-${seq}`,
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

async function makeCampaign(hostUserId: number): Promise<number> {
  const name = `BG3 My Data Hub ${seq}`;
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
        name: 'Shared run',
        hostUserId,
        createdByUserId: hostUserId,
      })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  return c.id;
}

async function insertSave(
  userId: number,
  campaignId: number,
  minute: number,
  sha: string | null,
): Promise<void> {
  const savedAt = new Date(T0.getTime() + minute * 60_000);
  await testApp.db.insert(schema.bg3Saves).values({
    uploaderUserId: userId,
    campaignId,
    campaignKey: KEY,
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

async function insertRef(
  userId: number,
  sha256: string,
  contract: string,
  referencedAt: Date,
): Promise<void> {
  await testApp.db.insert(schema.companionBlobRefs).values({
    userId,
    sha256,
    contract,
    byteLength: 1698,
    width: 1280,
    height: 720,
    referencedAt,
  });
}

/** Saves, binding, default and claim for `userId` in `campaignId`. */
async function seedBg3Data(
  userId: number,
  campaignId: number,
  slotKey: string,
): Promise<void> {
  await testApp.db
    .insert(schema.bg3CampaignKeys)
    .values({ userId, campaignKey: KEY, campaignId });
  await testApp.db
    .insert(schema.bg3UserDefaults)
    .values({ userId, campaignId });
  await testApp.db
    .insert(schema.bg3PartyClaims)
    .values({ userId, campaignId, slotKey });
}

/**
 * A: 2 saves sharing SHA1 + 1 without a thumbnail, binding, default, claim,
 * a `bg3-save` ref on SHA1, a ref on SHA1 for another contract and a
 * `bg3-save` ref on a sha no save uses. B: same campaign, a save on SHA1,
 * binding, default, claim and its own SHA1 ref. A hosts the campaign.
 */
async function seedWorld() {
  const a = await makeUser('a');
  const b = await makeUser('b');
  const campaignId = await makeCampaign(a.id);
  const past = new Date(Date.now() - HOUR);
  await insertSave(a.id, campaignId, 0, SHA1);
  await insertSave(a.id, campaignId, 1, SHA1);
  await insertSave(a.id, campaignId, 2, null);
  await seedBg3Data(a.id, campaignId, 'Generic:Human:1');
  await insertRef(a.id, SHA1, BG3_SAVE_CONTRACT_ID, past);
  await insertRef(a.id, SHA1, OTHER_CONTRACT, past);
  await insertRef(a.id, SHA_LOOSE, BG3_SAVE_CONTRACT_ID, past);
  await insertSave(b.id, campaignId, 0, SHA1);
  await seedBg3Data(b.id, campaignId, 'Generic:Duergar:1');
  await insertRef(b.id, SHA1, BG3_SAVE_CONTRACT_ID, past);
  return { a, b, campaignId };
}

// ── reads ──────────────────────────────────────────────────────────────────

interface Bg3Counts extends Record<string, unknown> {
  saves: number;
  campaignKeys: number;
  defaultCampaign: number;
  claims: number;
}

/** Rows per BG3 table for one user (one round trip). */
async function bg3Counts(userId: number): Promise<Bg3Counts> {
  const rows = await testApp.db.execute<Bg3Counts>(sql`SELECT
    (SELECT count(*)::int FROM bg3_saves WHERE uploader_user_id = ${userId}) AS "saves",
    (SELECT count(*)::int FROM bg3_campaign_keys WHERE user_id = ${userId}) AS "campaignKeys",
    (SELECT count(*)::int FROM bg3_user_defaults WHERE user_id = ${userId}) AS "defaultCampaign",
    (SELECT count(*)::int FROM bg3_party_claims WHERE user_id = ${userId}) AS "claims"`);
  const [row] = nonEmpty(rows, 'bg3 counts');
  return { ...row };
}

/** `contract:sha-prefix` of each ref the user holds, sorted. */
async function refsOf(userId: number): Promise<string[]> {
  const r = schema.companionBlobRefs;
  const rows = await testApp.db
    .select({ sha: r.sha256, contract: r.contract })
    .from(r)
    .where(eq(r.userId, userId));
  return rows.map((x) => `${x.contract}:${x.sha.slice(0, 4)}`).sort();
}

const del = (token: string) =>
  testApp.request.delete(URL).set('Authorization', `Bearer ${token}`);

// ── tests ──────────────────────────────────────────────────────────────────

describe('DELETE plugins/bg3/me/data', () => {
  it('no JWT → 401', async () => {
    expect((await testApp.request.delete(URL)).status).toBe(401);
  });

  it("deletes only the caller's BG3 data and releases only its bg3-save refs", async () => {
    const { a, b, campaignId } = await seedWorld();

    const res = await del(a.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deleted: {
        saves: 3,
        campaignKeys: 1,
        defaultCampaign: 1,
        claims: 1,
        thumbnailRefs: 1,
      },
    });
    expect(await bg3Counts(a.id)).toEqual({
      saves: 0,
      campaignKeys: 0,
      defaultCampaign: 0,
      claims: 0,
    });
    // A's SHA1 bg3-save ref is gone; its other-contract ref and the ref of a
    // blob no save ever used are not BG3 history and stay.
    expect(await refsOf(a.id)).toEqual(
      [
        `${BG3_SAVE_CONTRACT_ID}:${SHA_LOOSE.slice(0, 4)}`,
        `${OTHER_CONTRACT}:${SHA1.slice(0, 4)}`,
      ].sort(),
    );
    // B shares the sha and the campaign: untouched.
    expect(await bg3Counts(b.id)).toEqual({
      saves: 1,
      campaignKeys: 1,
      defaultCampaign: 1,
      claims: 1,
    });
    expect(await refsOf(b.id)).toEqual([
      `${BG3_SAVE_CONTRACT_ID}:${SHA1.slice(0, 4)}`,
    ]);
    // The campaign A hosts belongs to the hub and stays, host unchanged.
    const [campaign] = await testApp.db
      .select({ host: schema.bg3Campaigns.hostUserId })
      .from(schema.bg3Campaigns)
      .where(eq(schema.bg3Campaigns.id, campaignId));
    expect(campaign).toEqual({ host: a.id });
  });
});

describe('DELETE plugins/bg3/me/data — plugin state and repeats', () => {
  it('works with bg3 INACTIVE → 200 and the data is gone', async () => {
    const { a } = await seedWorld();
    await registry().deactivate(BG3_PLUGIN_ID);

    const res = await del(a.token);

    expect(res.status).toBe(200);
    expect((res.body as { deleted: Bg3MyDataDeleted }).deleted.saves).toBe(3);
    expect((await bg3Counts(a.id)).saves).toBe(0);
  });

  it('a second call deletes nothing and answers all zeros', async () => {
    const { a, b } = await seedWorld();
    expect((await del(a.token)).status).toBe(200);
    const refsAfterFirst = await refsOf(a.id);

    const res = await del(a.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: ZERO });
    expect(await refsOf(a.id)).toEqual(refsAfterFirst);
    expect((await bg3Counts(b.id)).saves).toBe(1);
  });
});

describe('Bg3MyDataRepository.deleteAllFor — ref cutoff', () => {
  it('a bg3-save ref refreshed after startedAt (concurrent ingest) survives', async () => {
    const a = await makeUser('cut');
    const campaignId = await makeCampaign(a.id);
    const startedAt = new Date(Date.now() - HOUR);
    await insertSave(a.id, campaignId, 0, SHA1);
    await insertSave(a.id, campaignId, 1, SHA_FRESH);
    const before = new Date(startedAt.getTime() - 60_000);
    const after = new Date(startedAt.getTime() + 60_000);
    await insertRef(a.id, SHA1, BG3_SAVE_CONTRACT_ID, before);
    await insertRef(a.id, SHA_FRESH, BG3_SAVE_CONTRACT_ID, after);

    const deleted = await testApp.app
      .get(Bg3MyDataRepository)
      .deleteAllFor(a.id, startedAt);

    expect(deleted).toEqual({ ...ZERO, saves: 2, thumbnailRefs: 1 });
    const r = schema.companionBlobRefs;
    const left = await testApp.db
      .select({ sha: r.sha256 })
      .from(r)
      .where(and(eq(r.userId, a.id), eq(r.contract, BG3_SAVE_CONTRACT_ID)));
    expect(left).toEqual([{ sha: SHA_FRESH }]);
  });
});
