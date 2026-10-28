/**
 * ROK-1957 §9.2 I-8 — "that's me" party claims against a real database:
 * claim → 204 and shown on the snapshot, the two 409s (incl. a real
 * unique-index race), slot validation against the newest canonical save,
 * the members-only / hidden / non-BG3 / inactive-plugin refusals, and who
 * may clear a claim. Spec says "create → 201"; the route answers 204 by
 * design (HANDOVER-1957-L5: no contract response shape).
 * Users are created once; every test builds its own hub + campaign, so
 * randomized order never shares a claim. No afterAll DB work: the shared
 * setup closes the pool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'supertest';
import {
  BG3_GAME_SLUG,
  Bg3CampaignSummarySchema,
  Bg3SaveMessageSchema,
  Bg3SnapshotSchema,
  type Bg3PartyMember,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';

type Who = 'admin' | 'host' | 'officer' | 'member' | 'member2' | 'outsider';

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
/** Slot keys of the fixture party (save order; the summon has none). */
const WOOD_ELF = 'Generic:Elf_WoodElf:1';
const HUMAN = 'Generic:Human:1';
const DUERGAR = 'Generic:Duergar:1';
const SUMMON = 'DogFamiliar_Scratch_Summon:Beast:1';
const KEY = 'ab'.repeat(32);
const T0 = new Date('2026-10-24T12:00:00Z');

let testApp: TestApp;
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, number>;
let bg3GameId = 0;
let seq = 0;

const registry = () => testApp.app.get(PluginRegistryService);

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
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
  userIds.admin = testApp.seed.adminUser.id;
  for (const who of [
    'host',
    'officer',
    'member',
    'member2',
    'outsider',
  ] as const) {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:bg3c-${who}@bg3-claims.test`,
          username: `bg3c-${who}`,
          displayName: `Claims ${who}`,
          role: 'member',
        })
        .returning(),
      `user ${who}`,
    );
    userIds[who] = u.id;
    tokens[who] = await signTestAccessToken(testApp, {
      sub: u.id,
      username: u.username,
      role: 'member',
    });
  }
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

/** A community hub: host + member + member2 members, officer an officer. */
async function insertHub(
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  seq += 1;
  const name = `BG3 Claims Hub ${seq}`;
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
        ...extra,
      })
      .returning(),
    'hub',
  );
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: g.id, userId: userIds.host, role: 'member' },
    { guildId: g.id, userId: userIds.officer, role: 'officer' },
    { guildId: g.id, userId: userIds.member, role: 'member' },
    { guildId: g.id, userId: userIds.member2, role: 'member' },
  ]);
  return g.id;
}

/** A save row in the campaign (party = the fixture unless overridden). */
async function insertSave(
  campaignId: number,
  over: Partial<typeof schema.bg3Saves.$inferInsert> = {},
): Promise<void> {
  await testApp.db.insert(schema.bg3Saves).values({
    uploaderUserId: userIds.host,
    campaignId,
    campaignKey: KEY,
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
    ...over,
  });
}

/** Host creates the campaign through the route (it becomes active). */
async function seedCampaign(
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<{ hubId: number; campaignId: number }> {
  const hubId = await insertHub();
  const res = await api('host')
    .post(`/plugins/bg3/hubs/${hubId}/campaigns`)
    .send({ name: `Campaign ${seq}` });
  expect(res.status).toBe(201);
  const campaignId = Bg3CampaignSummarySchema.parse(res.body).id;
  await insertSave(campaignId);
  if (Object.keys(extra).length > 0)
    await testApp.db
      .update(schema.guilds)
      .set(extra)
      .where(eq(schema.guilds.id, hubId));
  return { hubId, campaignId };
}

// ── requests ───────────────────────────────────────────────────────────────

function api(who: Who) {
  const auth = `Bearer ${tokens[who]}`;
  return {
    post: (url: string) => testApp.request.post(url).set('Authorization', auth),
    delete: (url: string) =>
      testApp.request.delete(url).set('Authorization', auth),
    get: (url: string) => testApp.request.get(url).set('Authorization', auth),
  };
}

const claimUrl = (campaignId: number) =>
  `/plugins/bg3/campaigns/${campaignId}/claims`;
const claim = (who: Who, campaignId: number, slotKey: string) =>
  api(who).post(claimUrl(campaignId)).send({ slotKey });
const clear = (who: Who, campaignId: number, slotKey: string) =>
  api(who).delete(`${claimUrl(campaignId)}/${slotKey}`);

const messageOf = (res: Response): unknown =>
  (res.body as { message?: unknown }).message;

async function claimsIn(campaignId: number) {
  const p = schema.bg3PartyClaims;
  return testApp.db
    .select({ slotKey: p.slotKey, userId: p.userId })
    .from(p)
    .where(eq(p.campaignId, campaignId));
}

// ── claim ──────────────────────────────────────────────────────────────────

describe('POST plugins/bg3/campaigns/:id/claims', () => {
  it('a member claims a slot → 204, stored, and shown on the snapshot', async () => {
    const { hubId, campaignId } = await seedCampaign();

    const res = await claim('member', campaignId, HUMAN);

    expect(res.status).toBe(204);
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userIds.member },
    ]);
    const snap = await api('member2').get(
      `/plugins/bg3/hubs/${hubId}/snapshot`,
    );
    expect(snap.status).toBe(200);
    const party = Bg3SnapshotSchema.parse(snap.body).party;
    expect(party.map((s) => s.slotKey)).toEqual([
      WOOD_ELF,
      null,
      HUMAN,
      DUERGAR,
      'Generic:Tiefling_Asmodeus:1',
    ]);
    expect(party.find((s) => s.slotKey === HUMAN)?.claim).toEqual({
      userId: userIds.member,
      displayName: 'Claims member',
      avatarUrl: null,
    });
    expect(party.filter((s) => s.claim !== null)).toHaveLength(1);
  });

  it('a second claim on a taken slot → 409 slot_taken; the first stays', async () => {
    const { campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);

    const res = await claim('member2', campaignId, HUMAN);

    expect(res.status).toBe(409);
    expect(messageOf(res)).toBe('slot_taken');
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userIds.member },
    ]);
  });

  it('the same user claiming a second slot → 409 already_claimed', async () => {
    const { campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);

    const res = await claim('member', campaignId, DUERGAR);

    expect(res.status).toBe(409);
    expect(messageOf(res)).toBe('already_claimed');
    expect(await claimsIn(campaignId)).toHaveLength(1);
  });

  it('two members racing for one slot → exactly one 204 and one 409 slot_taken', async () => {
    const { campaignId } = await seedCampaign();

    const results = await Promise.all([
      claim('member', campaignId, WOOD_ELF),
      claim('member2', campaignId, WOOD_ELF),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost && messageOf(lost)).toBe('slot_taken');
    expect(await claimsIn(campaignId)).toHaveLength(1);
  });

  it('one user racing for two slots → exactly one 204 and one 409 already_claimed', async () => {
    const { campaignId } = await seedCampaign();

    const results = await Promise.all([
      claim('member', campaignId, WOOD_ELF),
      claim('member', campaignId, DUERGAR),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost && messageOf(lost)).toBe('already_claimed');
    expect(await claimsIn(campaignId)).toHaveLength(1);
  });
});

describe('POST plugins/bg3/campaigns/:id/claims — slot validation', () => {
  it.each([
    ['a slot not in the party', 'Generic:Gnome:1'],
    ['the summon (not claimable)', SUMMON],
    ['an ordinal past the last same-race member', 'Generic:Human:2'],
  ])('%s → 400 unknown_slot, nothing stored', async (_label, slotKey) => {
    const { campaignId } = await seedCampaign();

    const res = await claim('member', campaignId, slotKey);

    expect(res.status).toBe(400);
    expect(messageOf(res)).toBe('unknown_slot');
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('a malformed slot key → 400, nothing stored', async () => {
    const { campaignId } = await seedCampaign();

    const res = await claim('member', campaignId, 'not a slot');

    expect(res.status).toBe(400);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('a slot only in an OLDER save → 400 unknown_slot (the newest save wins)', async () => {
    const { campaignId } = await seedCampaign();
    const human = PARTY[2];
    if (!human) throw new Error('fixture party has no third member');
    // Newer save: a solo Human party — the Wood Elf left.
    await insertSave(campaignId, {
      savedAt: new Date(T0.getTime() + 60_000),
      party: [human],
    });

    expect((await claim('member', campaignId, WOOD_ELF)).status).toBe(400);
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);
  });

  it("duplicate newest saves → the HOST's party defines the slots", async () => {
    const { campaignId } = await seedCampaign();
    const at = new Date(T0.getTime() + 60_000);
    const human = PARTY[2];
    const duergar = PARTY[3];
    if (!human || !duergar) throw new Error('fixture party too short');
    // Same (key, savedAt) from two uploaders; the non-host has another party.
    await insertSave(campaignId, {
      uploaderUserId: userIds.member2,
      savedAt: at,
      party: [duergar],
    });
    await insertSave(campaignId, { savedAt: at, party: [human] });

    const nonHostSlot = await claim('member', campaignId, DUERGAR);
    expect(nonHostSlot.status).toBe(400);
    expect(messageOf(nonHostSlot)).toBe('unknown_slot');
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);
  });
});

describe('POST plugins/bg3/campaigns/:id/claims — refusals', () => {
  it('a signed-in non-member → 403, nothing stored', async () => {
    const { campaignId } = await seedCampaign();

    const res = await claim('outsider', campaignId, HUMAN);

    expect(res.status).toBe(403);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('staff who are not hub members may claim → 204', async () => {
    const { campaignId } = await seedCampaign();

    expect((await claim('admin', campaignId, HUMAN)).status).toBe(204);
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userIds.admin },
    ]);
  });

  it('a hidden hub → 404 for a member', async () => {
    const { campaignId } = await seedCampaign({ hiddenAt: new Date() });

    expect((await claim('member', campaignId, HUMAN)).status).toBe(404);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('a campaign on a non-BG3 hub → 404', async () => {
    const hubId = await insertHub({ gameId: testApp.seed.game.id });
    const [c] = nonEmpty(
      await testApp.db
        .insert(schema.bg3Campaigns)
        .values({
          guildId: hubId,
          name: 'Wrong game',
          hostUserId: userIds.host,
        })
        .returning({ id: schema.bg3Campaigns.id }),
      'campaign',
    );
    await insertSave(c.id);

    expect((await claim('member', c.id, HUMAN)).status).toBe(404);
    expect(await claimsIn(c.id)).toEqual([]);
  });

  it('an unknown campaign → 404', async () => {
    expect((await claim('member', 2_000_000_000, HUMAN)).status).toBe(404);
  });

  it('bg3 inactive → 403, nothing stored', async () => {
    const { campaignId } = await seedCampaign();
    await registry().deactivate(BG3_PLUGIN_ID);

    expect((await claim('member', campaignId, HUMAN)).status).toBe(403);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('no JWT → 401', async () => {
    const { campaignId } = await seedCampaign();

    const res = await testApp.request
      .post(claimUrl(campaignId))
      .send({ slotKey: HUMAN });

    expect(res.status).toBe(401);
  });
});

// ── clear ──────────────────────────────────────────────────────────────────

describe('DELETE plugins/bg3/campaigns/:id/claims/:slotKey', () => {
  it.each<[string, Who]>([
    ['the claimant', 'member'],
    ['the campaign host', 'host'],
    ['a hub officer (editor)', 'officer'],
    ['staff', 'admin'],
  ])('%s may clear → 204 and the claim is gone', async (_label, who) => {
    const { campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);

    expect((await clear(who, campaignId, HUMAN)).status).toBe(204);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it.each<[string, Who]>([
    ['another member', 'member2'],
    ['a non-member', 'outsider'],
  ])('%s → 403 and the claim stays', async (_label, who) => {
    const { campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);

    expect((await clear(who, campaignId, HUMAN)).status).toBe(403);
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userIds.member },
    ]);
  });
});

describe('DELETE plugins/bg3/campaigns/:id/claims/:slotKey — edge cases', () => {
  it('a claimant who has left the hub can still clear their claim', async () => {
    const { hubId, campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);
    const m = schema.hubCommunityMembers;
    await testApp.db
      .delete(m)
      .where(and(eq(m.guildId, hubId), eq(m.userId, userIds.member)));

    expect((await clear('member', campaignId, HUMAN)).status).toBe(204);
    expect(await claimsIn(campaignId)).toEqual([]);
  });

  it('frees the slot for someone else', async () => {
    const { campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);
    expect((await clear('member', campaignId, HUMAN)).status).toBe(204);

    expect((await claim('member2', campaignId, HUMAN)).status).toBe(204);
    expect(await claimsIn(campaignId)).toEqual([
      { slotKey: HUMAN, userId: userIds.member2 },
    ]);
  });

  it('no claim on that slot → 404', async () => {
    const { campaignId } = await seedCampaign();

    expect((await clear('host', campaignId, HUMAN)).status).toBe(404);
  });

  it('a malformed slot key → 400', async () => {
    const { campaignId } = await seedCampaign();

    expect((await clear('host', campaignId, 'bad-slot')).status).toBe(400);
  });

  it('a hidden hub → 404 for the claimant', async () => {
    const { hubId, campaignId } = await seedCampaign();
    expect((await claim('member', campaignId, HUMAN)).status).toBe(204);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));

    expect((await clear('member', campaignId, HUMAN)).status).toBe(404);
    expect(await claimsIn(campaignId)).toHaveLength(1);
  });
});
