/**
 * ROK-1785 L6 — POST /admin/test/wow/seed-guild (integration, real DB).
 *
 * The DEMO_MODE fixture behind the guild-page smoke and fleet test plan:
 * one guild with ranks 0..4, a GM / delegated officer / plain member each
 * linked through a character GUID, an outsider, and a rank-1 editor grant.
 * Proven through the real `/plugins/wow/guilds/:id` access matrix.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  GUILD_ACTIVITY_KINDS,
  WowGuildProgressionPageSchema,
} from '@raid-ledger/contract';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { SettingsService } from '../settings/settings.service';
import { ALL_WOW_GAME_SLUGS } from '../plugins/wow-common/manifest';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import { nonEmpty } from '../common/testing/narrow';
import { defined } from '../common/defined.helpers';
import type { SeedGuildResponse } from './demo-test-guild.controller';
import {
  SEED_GUILD_LINKS,
  SEED_GUILD_RULES,
} from './demo-test-guild-content.helpers';
import { SEED_HUB_POST_NEWEST } from './demo-test-hub-posts.helpers';
import { SEED_GUILD_RECRUITMENT } from './demo-test-guild-recruitment.helpers';
import { SHOWCASE_OTHER_BOSS } from './demo-test-guild-activity.helpers';
import {
  SEED_LOCKOUT_SHARED,
  SEED_LOCKOUT_SOLO,
} from './demo-test-guild-lockouts.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/wow/seed-guild';

let testApp: TestApp;
let adminToken: string;

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

function seed(body: Record<string, unknown>) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

/**
 * The baseline integration seed's only game is the non-WoW `test-game`, which
 * the fixture rejects with 400 — so the suite seeds its own WoW game row.
 */
async function seedWowGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return;
  nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name: 'World of Warcraft: Forever',
        slug: WOW_FOREVER_GAME_SLUG,
      })
      .returning({ id: schema.games.id }),
    'WoW game',
  );
}

/** Seed against the suite's WoW game. */
async function seedGuild(
  name: string,
  extra: Record<string, unknown> = {},
): Promise<SeedGuildResponse> {
  const res = await seed({ name, gameSlug: WOW_FOREVER_GAME_SLUG, ...extra });
  expect(res.status).toBe(200);
  return res.body as SeedGuildResponse;
}

function tokenFor(user: { userId: number; username: string }): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.userId,
    username: user.username,
    role: 'member',
  });
}

function viewGuild(guildId: number, token: string) {
  return testApp.request
    .get(`/plugins/wow/guilds/${guildId}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await seedWowGame();
  await setDemoMode(true);
});

// No truncate here: integration-setup.ts's global afterAll (closeTestApp)
// runs first and ends the DB client; its beforeAll truncates every file.
afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/wow/seed-guild — gates + input', () => {
  it('is 403 with DEMO_MODE off', async () => {
    await setDemoMode(false);
    try {
      const res = await seed({
        name: 'Gate Guild',
        gameSlug: testApp.seed.game.slug,
      });
      expect(res.status).toBe(403);
    } finally {
      await setDemoMode(true);
    }
  });

  it('is 400 for a bad name and for a non-WoW slug', async () => {
    expect((await seed({ name: '!' })).status).toBe(400);
    expect(
      (await seed({ name: 'Ok Guild', gameSlug: 'minecraft' })).status,
    ).toBe(400);
  });

  it('is 404 (never creates a game) when the WoW game row is missing', async () => {
    const rows = await testApp.db
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(inArray(schema.games.slug, ALL_WOW_GAME_SLUGS));
    const present = new Set(rows.map((r) => r.slug));
    const missing = ALL_WOW_GAME_SLUGS.find((s) => !present.has(s));
    if (missing === undefined) throw new Error('every WoW slug is seeded');
    const before = (await testApp.db.select().from(schema.games)).length;
    const res = await seed({ name: 'No Game Guild', gameSlug: missing });
    expect(res.status).toBe(404);
    expect((await testApp.db.select().from(schema.games)).length).toBe(before);
  });
});

describe('POST /admin/test/wow/seed-guild — the cast', () => {
  it('seeds ranks 0..4, linked characters and a rank-1 editor grant', async () => {
    const out = await seedGuild('Smoke Keepers');
    expect(out.editorRankIndex).toBe(1);
    expect(out.unlinkedMemberIds).toHaveLength(2);
    const page = await viewGuild(out.guildId, await tokenFor(out.users.gm));
    expect(page.status).toBe(200);
    const ranks = (page.body.ranks as { rankIndex: number }[]).map(
      (r) => r.rankIndex,
    );
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    const editors = await testApp.request
      .get(`/plugins/wow/guilds/${out.guildId}/editors`)
      .set('Authorization', `Bearer ${adminToken}`);
    // ROK-1794: the rank grant is inert, so the seed also grants the rank's
    // member rows directly (the seeded officer keeps editing).
    expect(editors.body.editors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: out.editorId,
          kind: 'rank',
          rankIndex: 1,
        }),
        expect.objectContaining({ kind: 'member' }),
      ]),
    );
  });

  it.each([
    // GM_RANK_IMPLIES_EDIT is off: the GM has no implicit rights. Every
    // seeded rank is a hub member, so the viewer carries notificationsMuted.
    [
      'gm',
      200,
      {
        role: 'member',
        canEdit: false,
        canManageEditors: false,
        notificationsMuted: false,
        // ROK-1815: the seeded GM is rank 0 — labelled, not granted.
        isGuildMaster: true,
        isStaff: false,
        // ROK-1814 ruling 2026-10-30: the GM may change the crest (only).
        canEditCrest: true,
      },
    ],
    [
      'officer',
      200,
      {
        role: 'officer',
        canEdit: true,
        canManageEditors: false,
        notificationsMuted: false,
        isStaff: false,
        canEditCrest: true,
      },
    ],
    [
      'member',
      200,
      {
        role: 'member',
        canEdit: false,
        canManageEditors: false,
        notificationsMuted: false,
        isStaff: false,
        canEditCrest: false,
      },
    ],
    ['outsider', 403, undefined],
  ] as const)('%s → %i with viewer %o', async (role, status, viewer) => {
    const out = await seedGuild('Matrix Keepers');
    const res = await viewGuild(out.guildId, await tokenFor(out.users[role]));
    expect(res.status).toBe(status);
    if (viewer) expect(res.body.viewer).toEqual(viewer);
  });

  it('is idempotent per name: a re-call returns the same ids', async () => {
    const first = await seedGuild('Twice Keepers');
    const second = await seedGuild('Twice Keepers');
    expect(second).toEqual(first);
    const members = await testApp.db
      .select({ id: schema.guildMembers.id })
      .from(schema.guildMembers)
      .where(inArray(schema.guildMembers.guildId, [first.guildId]));
    expect(members).toHaveLength(5);
  });
});

describe('POST /admin/test/wow/seed-guild — guild raids (ROK-1787)', () => {
  it('seeds a tagged weekly series + a past raid the raids endpoint reads', async () => {
    const out = await seedGuild('Raid Keepers');
    expect(out.raids.seriesEventIds).toHaveLength(3);
    const res = await testApp.request
      .get(`/plugins/wow/guilds/${out.guildId}/raids`)
      .set('Authorization', `Bearer ${await tokenFor(out.users.gm)}`);
    expect(res.status).toBe(200);
    const [firstNight] = out.raids.seriesEventIds;
    expect(res.body.schedule).toEqual([
      expect.objectContaining({
        recurrenceGroupId: out.raids.seriesGroupId,
        eventId: firstNight,
        frequency: 'weekly',
        isNext: true,
      }),
    ]);
    expect(res.body.upcoming[0]).toMatchObject({
      id: firstNight,
      viewerStatus: 'signed_up',
      signupCount: 3,
      needed: 20,
    });
    expect(res.body.composition.roles).toEqual([
      { role: 'tank', filled: 1, needed: 2 },
      { role: 'healer', filled: 1, needed: 4 },
      { role: 'dps', filled: 0, needed: 14 },
    ]);
    // ROK-1926: the member benches with a level-52 alt, not the linked main.
    expect(res.body.composition.benched).toEqual([
      { characterId: out.raids.underLevelCharacterId, name: 'Daenvar' },
    ]);
    expect(res.body.recent).toEqual([
      expect.objectContaining({
        id: out.raids.pastEventId,
        signedUp: 2,
        attended: 1,
      }),
    ]);
    const att = res.body.attendance.rows as {
      userId: number;
      attended: number;
      of: number;
    }[];
    expect(att.map((r) => [r.userId, r.attended, r.of])).toEqual([
      [out.users.member.userId, 1, 1],
      [out.users.gm.userId, 0, 1],
      [out.users.officer.userId, 0, 1],
    ]);
  });

  it('is idempotent: a re-call returns the same raid ids', async () => {
    const first = await seedGuild('Raid Twice Keepers');
    const second = await seedGuild('Raid Twice Keepers');
    expect(second.raids).toEqual(first.raids);
  });
});

function guildGet(guildId: number, path: string, token: string) {
  return testApp.request
    .get(`/plugins/wow/guilds/${guildId}/${path}`)
    .set('Authorization', `Bearer ${token}`);
}

interface AddonBody {
  id: number;
  source: string;
  slugOrUrl: string;
  requirement: string;
  sortOrder: number;
}

describe('POST /admin/test/wow/seed-guild — withContent (ROK-1786)', () => {
  it('without the flag: no content key, empty profile and no addons', async () => {
    const out = await seedGuild('Bare Keepers');
    expect(out).not.toHaveProperty('content');
    const token = await tokenFor(out.users.member);
    const profile = await guildGet(out.guildId, 'profile', token);
    expect(profile.body).toEqual({
      guildId: out.guildId,
      gmPost: null,
      rules: [],
      links: [],
      // ROK-1868 A3: the profile carries the newest hub post (none here).
      latestPost: null,
    });
    const addons = await guildGet(out.guildId, 'addons', token);
    expect(addons.body.addons).toEqual([]);
  });

  it('seeds the GM post, rules, links and two addons a plain member can read', async () => {
    const out = await seedGuild('Content Keepers', { withContent: true });
    const token = await tokenFor(out.users.member);
    const profile = await guildGet(out.guildId, 'profile', token);
    expect(profile.status).toBe(200);
    expect(profile.body.gmPost).toEqual(
      // ROK-1868 A3: gmPost is derived from the newest seeded hub post.
      expect.objectContaining({ body: SEED_HUB_POST_NEWEST }),
    );
    expect(profile.body.rules).toEqual(SEED_GUILD_RULES);
    expect(profile.body.links).toEqual(SEED_GUILD_LINKS);
    const addons = await guildGet(out.guildId, 'addons', token);
    const rows = addons.body.addons as AddonBody[];
    expect(rows.map((a) => [a.source, a.requirement, a.sortOrder])).toEqual([
      ['curseforge', 'required', 0],
      ['github', 'optional', 1],
    ]);
    expect(rows.map((a) => a.id)).toEqual(out.content?.addonIds);
    expect(addons.body.pinned[0]).toEqual(
      expect.objectContaining({ name: 'LedgerLink' }),
    );
  });
});

describe('POST /admin/test/wow/seed-guild — withContent re-seed (ROK-1786)', () => {
  it('a re-call restores edited content with the same addon ids', async () => {
    const first = await seedGuild('Restore Keepers', { withContent: true });
    const officer = await tokenFor(first.users.officer);
    const base = `/plugins/wow/guilds/${first.guildId}`;
    // ROK-1868: a new post (not the retired PATCH profile gmPost) is the edit.
    const posted = await testApp.request
      .post(`/guilds/${first.guildId}/posts`)
      .set('Authorization', `Bearer ${officer}`)
      .send({ body: 'Changed by the smoke', relayToDiscord: false });
    expect(posted.status).toBe(201);
    const added = await testApp.request
      .post(`${base}/addons`)
      .set('Authorization', `Bearer ${officer}`)
      .send({ url: 'https://github.com/stanzilla/advancedinterfaceoptions' });
    expect(added.status).toBe(201);
    const second = await seedGuild('Restore Keepers', { withContent: true });
    expect(second.content?.addonIds).toEqual(first.content?.addonIds);
    const token = await tokenFor(first.users.member);
    const profile = await guildGet(first.guildId, 'profile', token);
    expect(profile.body.gmPost.body).toBe(SEED_HUB_POST_NEWEST);
    const addons = await guildGet(first.guildId, 'addons', token);
    expect((addons.body.addons as AddonBody[]).map((a) => a.id)).toEqual(
      first.content?.addonIds,
    );
  });

  it('is 400 for a non-boolean withContent', async () => {
    const res = await seed({ name: 'Flag Keepers', withContent: 'yes' });
    expect(res.status).toBe(400);
  });
});

interface LockoutGroup {
  name: string;
  members: { name: string; killed: number }[];
}

describe('POST /admin/test/wow/seed-guild — withLockouts (ROK-1914)', () => {
  it('seeds a shared live save, a solo live save and an expired one the insights drop', async () => {
    const out = await seedGuild('Saved Keepers', { withLockouts: true });
    expect(out.lockouts?.characterIds).toHaveLength(3);
    const res = await guildGet(
      out.guildId,
      'roster-insights',
      await tokenFor(out.users.gm),
    );
    expect(res.status).toBe(200);
    const groups = (res.body.lockouts as LockoutGroup[]).map((g) => [
      g.name,
      g.members.map((m) => `${m.name} ${m.killed}`),
    ]);
    expect(groups).toEqual([
      [SEED_LOCKOUT_SHARED.name, ['Aldren 10', 'Brisa 4']],
      [SEED_LOCKOUT_SOLO.name, ['Dainel 1']],
    ]);
    // gm, officer and the solo member each reported saves (linked chars).
    expect(res.body.lockoutReporters).toBe(3);
  });

  it('without the flag: no lockouts key and no snapshots', async () => {
    const out = await seedGuild('Unsaved Keepers');
    expect(out).not.toHaveProperty('lockouts');
    const ids = [out.users.gm.characterId, out.users.member.characterId].filter(
      (id): id is string => id !== null,
    );
    const rows = await testApp.db
      .select({ id: schema.characterAddonSnapshots.id })
      .from(schema.characterAddonSnapshots)
      .where(inArray(schema.characterAddonSnapshots.characterId, ids));
    expect(rows).toEqual([]);
  });

  it('is 400 for a non-boolean withLockouts', async () => {
    const res = await seed({ name: 'Flag Savers', withLockouts: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/test/wow/seed-guild — withArmorySnapshots (ROK-2149)', () => {
  const armory = schema.guildMemberArmory;

  it('snapshots every unlinked row but the last; the member page reads it', async () => {
    const out = await seedGuild('Armory Keepers', {
      withArmorySnapshots: true,
    });
    const [first, last] = out.unlinkedMemberIds;
    expect(out.armorySnapshots).toEqual({
      memberIds: [first],
      withoutSnapshot: [last],
    });
    const rows = await testApp.db
      .select({ id: armory.guildMemberId, failures: armory.failures })
      .from(armory)
      .where(inArray(armory.guildMemberId, out.unlinkedMemberIds));
    expect(rows).toEqual([{ id: first, failures: 0 }]);
    const res = await testApp.request
      .get(`/plugins/wow/guilds/${out.guildId}/members/${first}`)
      .set('Authorization', `Bearer ${await tokenFor(out.users.member)}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('noArmoryReason');
    expect(res.body).toMatchObject({
      class: 'Warrior',
      spec: 'Arms',
      itemLevel: 63,
      talents: { format: 'classic' },
      lastSeen: { online: false, lastOnlineDays: 1 },
    });
    expect(res.body.equipment?.items).toHaveLength(3);
  });

  it('without the flag: no armorySnapshots key and no snapshot rows', async () => {
    const out = await seedGuild('Armoryless Keepers');
    expect(out).not.toHaveProperty('armorySnapshots');
    const rows = await testApp.db
      .select({ id: armory.guildMemberId })
      .from(armory)
      .where(inArray(armory.guildMemberId, out.unlinkedMemberIds));
    expect(rows).toEqual([]);
  });

  it('is 400 for a non-boolean withArmorySnapshots', async () => {
    const res = await seed({ name: 'Flag Armory', withArmorySnapshots: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/test/wow/seed-guild — withRecruitment (ROK-1789)', () => {
  const recruitmentPath = (id: number): string =>
    `/plugins/wow/guilds/${id}/recruitment`;

  it('seeds the AC12 recruitment as the GM; a re-seed restores it', async () => {
    const out = await seedGuild('Recruit Seed Keepers', {
      withRecruitment: true,
    });
    expect(out.recruitment).toEqual(SEED_GUILD_RECRUITMENT);
    const gmToken = `Bearer ${await tokenFor(out.users.gm)}`;
    const read = await testApp.request
      .get(recruitmentPath(out.guildId))
      .set('Authorization', gmToken);
    expect(read.status).toBe(200);
    expect(read.body.recruitment).toEqual(SEED_GUILD_RECRUITMENT);
    expect(read.body.state).toBe('open');
    expect(read.body.updatedBy).not.toBeNull();
    const closed = await testApp.request
      .put(recruitmentPath(out.guildId))
      .set('Authorization', gmToken)
      .send({ ...SEED_GUILD_RECRUITMENT, recruiting: false });
    expect(closed.body.state).toBe('closed');
    await seedGuild('Recruit Seed Keepers', { withRecruitment: true });
    const again = await testApp.request
      .get(recruitmentPath(out.guildId))
      .set('Authorization', gmToken);
    expect(again.body.recruitment).toEqual(SEED_GUILD_RECRUITMENT);
  });

  it('without the flag: no recruitment key', async () => {
    const out = await seedGuild('Recruitless Keepers');
    expect(out).not.toHaveProperty('recruitment');
  });

  it('is 400 for a non-boolean withRecruitment', async () => {
    const res = await seed({ name: 'Flag Recruit', withRecruitment: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/test/wow/seed-guild — summary overrides (ROK-1170)', () => {
  const FOUNDED = '2024-03-15T12:00:00.000Z';

  it('writes foundedAt + status; the page sends them; a plain re-seed clears them', async () => {
    const out = await seedGuild('Founded Keepers', {
      foundedAt: FOUNDED,
      blizzardSummaryStatus: 'disbanded',
    });
    const token = await tokenFor(out.users.member);
    const page = await viewGuild(out.guildId, token);
    expect(page.status).toBe(200);
    expect(page.body.guild.blizzardGuild).toEqual({
      foundedAt: FOUNDED,
      state: 'disbanded',
    });
    await seedGuild('Founded Keepers');
    const cleared = await viewGuild(out.guildId, token);
    expect(cleared.body.guild.blizzardGuild).toEqual({
      foundedAt: null,
      state: null,
    });
  });

  it('is 400 for a non-ISO foundedAt and for an unknown status', async () => {
    const bad = [{ foundedAt: 'March' }, { blizzardSummaryStatus: 'gone' }];
    for (const extra of bad) {
      expect((await seed({ name: 'Flag Founded', ...extra })).status).toBe(400);
    }
  });
});

describe('POST /admin/test/wow/seed-guild — memberCount (ROK-1789 B9)', () => {
  it('pads the roster to 50 rows with roster-only fillers; a re-seed keeps the ids', async () => {
    const out = await seedGuild('Padded Keepers', { memberCount: 50 });
    expect(out.fillerMemberIds).toHaveLength(45);
    const rows = await testApp.db
      .select({ rank: schema.guildMembers.rankIndex })
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.guildId, out.guildId));
    expect(rows).toHaveLength(50);
    expect(rows.filter((r) => r.rank === 1)).toHaveLength(2);
    expect(rows.filter((r) => r.rank === 0)).toHaveLength(1);
    const again = await seedGuild('Padded Keepers', { memberCount: 50 });
    expect(again.fillerMemberIds).toEqual(out.fillerMemberIds);
  });

  it('is 400 below 5, above 60 or for a non-integer', async () => {
    for (const memberCount of [4, 61, 12.5, '50']) {
      const res = await seed({ name: 'Flag Padded', memberCount });
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /admin/test/wow/seed-guild — withActivity (ROK-1789 B9)', () => {
  it('backdates the guild, stamps a ≥10-row import, events and map-tagged pulls', async () => {
    const out = await seedGuild('Busy Keepers', { withActivity: true });
    const activity = defined(out.activity, 'activity');
    expect(out.fillerMemberIds).toHaveLength(45);
    expect(out.pulls).toBeDefined();
    expect(out.dings).toBeDefined();
    const [guild] = await testApp.db
      .select({ createdAt: schema.guilds.createdAt })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, out.guildId));
    expect(guild?.createdAt.toISOString()).toBe(activity.guildCreatedAt);
    const imported = await testApp.db
      .select({ createdAt: schema.guildMembers.createdAt })
      .from(schema.guildMembers)
      .where(inArray(schema.guildMembers.id, activity.stamped.roster_import));
    expect(imported.length).toBeGreaterThanOrEqual(10);
    const stamps = new Set(imported.map((r) => r.createdAt.toISOString()));
    expect([...stamps]).toEqual([activity.rosterImportAt]);
    expect(activity.stamped.new_member).toHaveLength(4);
    expect(activity.events.ended).toHaveLength(2);
    expect(activity.events.cancelled).toHaveLength(1);
  });

  it('tags Molten Core pulls with map 409; Lucifron + the unknown boss have none', async () => {
    const out = await seedGuild('Mapped Keepers', { withActivity: true });
    const p = schema.addonEncounterPulls;
    const pulls = await testApp.db
      .select({ name: p.encounterName, instanceId: p.instanceId })
      .from(p)
      .where(and(eq(p.guildKey, 'mapped keepers'), eq(p.gameId, out.gameId)));
    const unmapped = pulls.filter((r) => r.instanceId === null);
    expect(unmapped.map((r) => r.name).sort()).toEqual(
      ['Lucifron', SHOWCASE_OTHER_BOSS].sort(),
    );
    expect(pulls.filter((r) => r.instanceId === 409).length).toBeGreaterThan(4);
    await seedGuild('Mapped Keepers', { withActivity: true });
    const again = await testApp.db
      .select({ name: p.encounterName })
      .from(p)
      .where(and(eq(p.guildKey, 'mapped keepers'), eq(p.gameId, out.gameId)));
    expect(again).toHaveLength(pulls.length);
  });

  it('the progression route returns every activity kind for the seed (LB4)', async () => {
    const registry = testApp.app.get(PluginRegistryService);
    await registry.ensureInstalled('blizzard');
    await registry.activate('blizzard');
    const out = await seedGuild('Route Keepers', { withActivity: true });
    const res = await guildGet(out.guildId, 'progression', adminToken);
    expect(res.status).toBe(200);
    const body = WowGuildProgressionPageSchema.parse(res.body);
    const kinds = new Set(body.activity.entries.map((e) => e.kind));
    expect([...kinds].sort()).toEqual([...GUILD_ACTIVITY_KINDS].sort());
    expect(body.progression.instances.length).toBeGreaterThan(0);
  });

  it('is 400 for a non-boolean withActivity or asCaller', async () => {
    for (const extra of [{ withActivity: 1 }, { asCaller: 'yes' }]) {
      expect((await seed({ name: 'Flag Busy', ...extra })).status).toBe(400);
    }
  });
});

describe('POST /admin/test/wow/seed-guild — asCaller (ROK-1789 B9, Q-B16)', () => {
  it('makes the JWT caller the rank-0 GUID owner with a member editor grant', async () => {
    const admin = testApp.seed.adminUser;
    const out = await seedGuild('Caller Keepers', { asCaller: true });
    expect(out.users.gm.userId).toBe(admin.id);
    expect(out.users.gm.rankIndex).toBe(0);
    const gmChar = defined(out.users.gm.characterId ?? undefined, 'gm char');
    const [owned] = await testApp.db
      .select({ userId: schema.characters.userId })
      .from(schema.characters)
      .where(eq(schema.characters.id, gmChar));
    expect(owned?.userId).toBe(admin.id);
    const grants = await testApp.db
      .select({ memberId: schema.guildEditors.guildMemberId })
      .from(schema.guildEditors)
      .where(eq(schema.guildEditors.guildId, out.guildId));
    expect(grants.map((g) => g.memberId)).toContain(out.users.gm.memberId);
    const again = await seedGuild('Caller Keepers', { asCaller: true });
    expect(again.users.gm.characterId).toBe(out.users.gm.characterId);
  });
});
