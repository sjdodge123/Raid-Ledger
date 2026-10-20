/**
 * ROK-1785 L6 — POST /admin/test/wow/seed-guild (integration, real DB).
 *
 * The DEMO_MODE fixture behind the guild-page smoke and fleet test plan:
 * one guild with ranks 0..4, a GM / delegated officer / plain member each
 * linked through a character GUID, an outsider, and a rank-1 editor grant.
 * Proven through the real `/plugins/wow/guilds/:id` access matrix.
 */
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import { ALL_WOW_GAME_SLUGS } from '../plugins/wow-common/manifest';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import { nonEmpty } from '../common/testing/narrow';
import type { SeedGuildResponse } from './demo-test-guild.controller';
import {
  SEED_GUILD_GM_POST,
  SEED_GUILD_LINKS,
  SEED_GUILD_RULES,
} from './demo-test-guild-content.helpers';

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

function tokenFor(user: { userId: number; username: string }): string {
  return testApp.app
    .get(JwtService)
    .sign({ sub: user.userId, username: user.username, role: 'member' });
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
    const page = await viewGuild(out.guildId, tokenFor(out.users.gm));
    expect(page.status).toBe(200);
    const ranks = (page.body.ranks as { rankIndex: number }[]).map(
      (r) => r.rankIndex,
    );
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    const editors = await testApp.request
      .get(`/plugins/wow/guilds/${out.guildId}/editors`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(editors.body.editors).toEqual([
      expect.objectContaining({ id: out.editorId, kind: 'rank', rankIndex: 1 }),
    ]);
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
      },
    ],
    ['outsider', 403, undefined],
  ] as const)('%s → %i with viewer %o', async (role, status, viewer) => {
    const out = await seedGuild('Matrix Keepers');
    const res = await viewGuild(out.guildId, tokenFor(out.users[role]));
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
      .set('Authorization', `Bearer ${tokenFor(out.users.gm)}`);
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
    expect(res.body.composition.benched).toEqual([
      { characterId: out.users.member.characterId, name: 'Dainel' },
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
    const token = tokenFor(out.users.member);
    const profile = await guildGet(out.guildId, 'profile', token);
    expect(profile.body).toEqual({
      guildId: out.guildId,
      gmPost: null,
      rules: [],
      links: [],
    });
    const addons = await guildGet(out.guildId, 'addons', token);
    expect(addons.body.addons).toEqual([]);
  });

  it('seeds the GM post, rules, links and two addons a plain member can read', async () => {
    const out = await seedGuild('Content Keepers', { withContent: true });
    const token = tokenFor(out.users.member);
    const profile = await guildGet(out.guildId, 'profile', token);
    expect(profile.status).toBe(200);
    expect(profile.body.gmPost).toEqual(
      expect.objectContaining({ body: SEED_GUILD_GM_POST }),
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
    const officer = tokenFor(first.users.officer);
    const base = `/plugins/wow/guilds/${first.guildId}`;
    const patched = await testApp.request
      .patch(`${base}/profile`)
      .set('Authorization', `Bearer ${officer}`)
      .send({ gmPost: 'Changed by the smoke' });
    expect(patched.status).toBe(200);
    const added = await testApp.request
      .post(`${base}/addons`)
      .set('Authorization', `Bearer ${officer}`)
      .send({ url: 'https://github.com/stanzilla/advancedinterfaceoptions' });
    expect(added.status).toBe(201);
    const second = await seedGuild('Restore Keepers', { withContent: true });
    expect(second.content?.addonIds).toEqual(first.content?.addonIds);
    const token = tokenFor(first.users.member);
    const profile = await guildGet(first.guildId, 'profile', token);
    expect(profile.body.gmPost.body).toBe(SEED_GUILD_GM_POST);
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
