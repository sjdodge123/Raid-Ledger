/**
 * ROK-2153 S6 — the REAL BG3 hub claim provider (`Bg3HubClaimProvider`) on
 * the core claim routes (`GET/POST guilds/:id/claim`) against a real
 * database. Rulings in force: the hub's ACTIVE campaign only, list only (no
 * suggestion), per-campaign dismissal scope. Candidate ids are
 * `<campaignId>:<slotKey>`; summons are never candidates.
 * Every test builds its own hub + campaign (unique save keys), so randomized
 * order never shares a claim. No afterAll DB work: the shared setup closes
 * the pool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  Bg3CampaignSummarySchema,
  Bg3SaveMessageSchema,
  HubClaimResultSchema,
  HubClaimStatusSchema,
  type Bg3PartyMember,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';

type Who = 'host' | 'member' | 'member2' | 'outsider';

const PARTY: Bg3PartyMember[] = Bg3SaveMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
      ),
      'utf8',
    ),
  ) as unknown,
).payload.party;
/** Slot keys of the fixture party (save order; the summon is never a slot). */
const WOOD_ELF = 'Generic:Elf_WoodElf:1';
const HUMAN = 'Generic:Human:1';
const DUERGAR = 'Generic:Duergar:1';
const TIEFLING = 'Generic:Tiefling_Asmodeus:1';
const SUMMON = 'DogFamiliar_Scratch_Summon:Beast:1';
const SLOTS = [WOOD_ELF, HUMAN, DUERGAR, TIEFLING];
const T0 = new Date('2026-10-24T12:00:00Z');

let testApp: TestApp;
const tokens = new Map<Who, string>();
const userIds = new Map<Who, number>();
let bg3GameId = 0;
let seq = 0;

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const registry = () => testApp.app.get(PluginRegistryService);
const token = (who: Who) => must(tokens.get(who), `token ${who}`);
const userId = (who: Who) => must(userIds.get(who), `user ${who}`);
const cid = (campaignId: number, slotKey: string) => `${campaignId}:${slotKey}`;

async function findOrCreateBg3Game(): Promise<number> {
  const g = schema.games;
  const [found] = await testApp.db
    .select({ id: g.id })
    .from(g)
    .where(eq(g.slug, BG3_GAME_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(g)
      .values({ name: "Baldur's Gate 3", slug: BG3_GAME_SLUG })
      .returning({ id: g.id }),
    'bg3 game',
  );
  return made.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  for (const who of ['host', 'member', 'member2', 'outsider'] as const) {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:bg3hc-${who}@bg3-hub-claim.test`,
          username: `bg3hc-${who}`,
          displayName: `Hub claim ${who}`,
          role: 'member',
        })
        .returning(),
      `user ${who}`,
    );
    userIds.set(who, u.id);
    tokens.set(
      who,
      await signTestAccessToken(testApp, {
        sub: u.id,
        username: u.username,
        role: 'member',
      }),
    );
  }
  bg3GameId = await findOrCreateBg3Game();
});

beforeEach(async () => {
  await registry().ensureInstalled(BG3_PLUGIN_ID);
  if (!registry().isActive(BG3_PLUGIN_ID)) {
    await registry().activate(BG3_PLUGIN_ID);
  }
});

// ── seeding ────────────────────────────────────────────────────────────────

/** A `game_community` hub; host, member and member2 are members. */
async function insertHub(gameId: number = bg3GameId): Promise<number> {
  seq += 1;
  const name = `BG3 Hub Claim ${seq} ${Date.now() % 100000}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        status: 'active',
        name,
        nameKey: name.toLowerCase(),
        lastSnapshotAt: new Date(),
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: g.id, userId: userId('host'), role: 'member' },
    { guildId: g.id, userId: userId('member'), role: 'member' },
    { guildId: g.id, userId: userId('member2'), role: 'member' },
  ]);
  return g.id;
}

/** A 64-hex campaign key unique to this test run (saves are keyed by it). */
function uniqueKey(): string {
  seq += 1;
  return `${Date.now().toString(16)}${seq.toString(16)}`.padStart(64, '0');
}

async function insertSave(campaignId: number): Promise<void> {
  await testApp.db.insert(schema.bg3Saves).values({
    uploaderUserId: userId('host'),
    campaignId,
    campaignKey: uniqueKey(),
    campaignKeySource: 'save-folder',
    saveName: 'QuickSave_1',
    savedAt: T0,
    capturedAt: T0,
    gameVersion: '4.1.1.7631656',
    platform: 'Steam',
    currentLevel: 'SCL_Main_A',
    difficulty: 'DifficultyHard',
    ruleset: 'RulesetLarian',
    party: PARTY,
    partyMaxLevel: 8,
  });
}

/** Host creates a campaign through the BG3 route and a save for it. */
async function createCampaign(hubId: number): Promise<number> {
  const res = await testApp.request
    .post(`/plugins/bg3/hubs/${hubId}/campaigns`)
    .set('Authorization', `Bearer ${token('host')}`)
    .send({ name: `Campaign ${seq}` });
  expect(res.status).toBe(201);
  const campaignId = Bg3CampaignSummarySchema.parse(res.body).id;
  await insertSave(campaignId);
  return campaignId;
}

/** A BG3 hub whose first (thus active) campaign has the fixture party. */
async function seedHub(): Promise<{ hubId: number; campaignId: number }> {
  const hubId = await insertHub();
  const campaignId = await createCampaign(hubId);
  return { hubId, campaignId };
}

async function setActive(hubId: number, campaignId: number | null) {
  await testApp.db
    .update(schema.bg3HubSettings)
    .set({ activeCampaignId: campaignId })
    .where(eq(schema.bg3HubSettings.guildId, hubId));
}

async function insertClaim(campaignId: number, slotKey: string, who: Who) {
  await testApp.db
    .insert(schema.bg3PartyClaims)
    .values({ campaignId, slotKey, userId: userId(who) });
}

// ── requests ───────────────────────────────────────────────────────────────

const getStatus = (hubId: number, who: Who = 'member') =>
  testApp.request
    .get(`/guilds/${hubId}/claim`)
    .set('Authorization', `Bearer ${token(who)}`);

const postClaim = (hubId: number, candidateId: string, who: Who = 'member') =>
  testApp.request
    .post(`/guilds/${hubId}/claim/${encodeURIComponent(candidateId)}`)
    .set('Authorization', `Bearer ${token(who)}`)
    .send({});

/** The status body's candidate ids, sorted; throws on a malformed body. */
const ids = (body: unknown): string[] =>
  HubClaimStatusSchema.parse(body)
    .candidates.map((c) => c.id)
    .sort();

async function claimsIn(campaignId: number) {
  const p = schema.bg3PartyClaims;
  return testApp.db
    .select({ slotKey: p.slotKey, userId: p.userId })
    .from(p)
    .where(eq(p.campaignId, campaignId));
}

// ── status ─────────────────────────────────────────────────────────────────

describe('GET guilds/:id/claim — BG3 provider status', () => {
  it("lists the active campaign's unclaimed non-summon slots, no suggestion", async () => {
    const { hubId, campaignId } = await seedHub();
    const res = await getStatus(hubId);
    expect(res.status).toBe(200);
    expect(HubClaimStatusSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      provider: BG3_PLUGIN_ID,
      viewerIsMember: true,
      viewerHasClaim: false,
      suggested: null,
      unclaimedCount: 4,
      truncated: false,
      claimOptions: 'none',
      dismissScope: `campaign-${campaignId}`,
    });
    expect(ids(res.body)).toEqual(SLOTS.map((s) => cid(campaignId, s)).sort());
    expect(ids(res.body)).not.toContain(cid(campaignId, SUMMON));
    for (const c of HubClaimStatusSchema.parse(res.body).candidates) {
      expect(c.match).toBeNull();
    }
  });

  it("another user's claimed slot is not a candidate; that user has a claim", async () => {
    const { hubId, campaignId } = await seedHub();
    await insertClaim(campaignId, HUMAN, 'member2');
    const res = await getStatus(hubId, 'member');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ viewerHasClaim: false, unclaimedCount: 3 });
    expect(ids(res.body)).toEqual(
      [WOOD_ELF, DUERGAR, TIEFLING].map((s) => cid(campaignId, s)).sort(),
    );
    const theirs = await getStatus(hubId, 'member2');
    expect(theirs.status).toBe(200);
    expect(theirs.body.viewerHasClaim).toBe(true);
  });

  it('no active campaign: nothing to claim and no dismissScope key', async () => {
    const { hubId } = await seedHub();
    await setActive(hubId, null);
    const res = await getStatus(hubId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: BG3_PLUGIN_ID,
      viewerHasClaim: false,
      unclaimedCount: 0,
      candidates: [],
      suggested: null,
    });
    expect(res.body).not.toHaveProperty('dismissScope');
    const bare = await getStatus(await insertHub());
    expect(bare.status).toBe(200);
    expect(bare.body.unclaimedCount).toBe(0);
    expect(bare.body).not.toHaveProperty('dismissScope');
  });
});

// ── claim ──────────────────────────────────────────────────────────────────

describe('POST guilds/:id/claim/:candidateId — BG3 party claim', () => {
  it('claims a slot: the claim row is written and status reports it', async () => {
    const { hubId, campaignId } = await seedHub();
    const res = await postClaim(hubId, cid(campaignId, HUMAN));
    expect(res.status).toBe(200);
    expect(HubClaimResultSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      claimed: { id: cid(campaignId, HUMAN), match: null },
      becameMember: false,
      characterId: null,
    });
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userId('member') },
    ]);
    const after = await getStatus(hubId);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ viewerHasClaim: true, unclaimedCount: 3 });
    expect(ids(after.body)).not.toContain(cid(campaignId, HUMAN));
  });

  it('a slot taken by another user → 409 CANDIDATE_TAKEN; the claim stays', async () => {
    const { hubId, campaignId } = await seedHub();
    await insertClaim(campaignId, HUMAN, 'member2');
    const res = await postClaim(hubId, cid(campaignId, HUMAN));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_TAKEN');
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userId('member2') },
    ]);
  });

  it('a viewer who already claimed → 409 VIEWER_HAS_CLAIM; one claim stays', async () => {
    const { hubId, campaignId } = await seedHub();
    expect((await postClaim(hubId, cid(campaignId, HUMAN))).status).toBe(200);
    const res = await postClaim(hubId, cid(campaignId, DUERGAR));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('HUB_CLAIM_VIEWER_HAS_CLAIM');
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userId('member') },
    ]);
  });

  it.each([
    ['a slot not in the party', 'Generic:Gnome:1'],
    ['the summon', SUMMON],
  ])('%s → 404 CANDIDATE_GONE, nothing stored', async (_label, slotKey) => {
    const { hubId, campaignId } = await seedHub();
    const res = await postClaim(hubId, cid(campaignId, slotKey));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_GONE');
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('a non-member → 403 on GET and POST, nothing stored', async () => {
    const { hubId, campaignId } = await seedHub();
    const res = await getStatus(hubId, 'outsider');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HUB_CLAIM_FORBIDDEN');
    const post = await postClaim(hubId, cid(campaignId, HUMAN), 'outsider');
    expect(post.status).toBe(403);
    expect(post.body.code).toBe('HUB_CLAIM_FORBIDDEN');
    expect(await claimsIn(campaignId)).toEqual([]);
  });
});

// ── active-campaign scope ──────────────────────────────────────────────────

describe('guilds/:id/claim — BG3 active campaign switch', () => {
  it('switching the active campaign moves the scope, the slots and the claim', async () => {
    const { hubId, campaignId: first } = await seedHub();
    const second = await createCampaign(hubId);
    // The route only makes a campaign active when none is; the first stays.
    const before = await getStatus(hubId, 'member2');
    expect(before.body.dismissScope).toBe(`campaign-${first}`);
    expect((await postClaim(hubId, cid(first, HUMAN), 'member2')).status).toBe(
      200,
    );

    await setActive(hubId, second);
    const res = await getStatus(hubId, 'member2');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      viewerHasClaim: false,
      unclaimedCount: 4,
      dismissScope: `campaign-${second}`,
    });
    expect(ids(res.body)).toEqual(SLOTS.map((s) => cid(second, s)).sort());
    expect(await claimsIn(first)).toEqual([
      { slotKey: HUMAN, userId: userId('member2') },
    ]);
  });

  it("a candidate of a campaign no longer active → 404 CANDIDATE_GONE; neither campaign gets a claim", async () => {
    const { hubId, campaignId: first } = await seedHub();
    const second = await createCampaign(hubId);
    await setActive(hubId, second);
    const res = await postClaim(hubId, cid(first, HUMAN));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_GONE');
    expect(await claimsIn(first)).toEqual([]);
    expect(await claimsIn(second)).toEqual([]);
  });
});

// ── not a BG3 hub ──────────────────────────────────────────────────────────

describe('guilds/:id/claim — non-BG3 game_community hub', () => {
  it('no BG3 provider: 404 UNAVAILABLE on GET and POST', async () => {
    const hubId = await insertHub(testApp.seed.game.id);
    const res = await getStatus(hubId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    const post = await postClaim(hubId, `1:${HUMAN}`);
    expect(post.status).toBe(404);
    expect(post.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });
});
