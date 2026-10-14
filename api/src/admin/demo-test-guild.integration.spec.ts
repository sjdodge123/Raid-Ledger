/**
 * ROK-1785 L6 — POST /admin/test/wow/seed-guild (integration, real DB).
 *
 * The DEMO_MODE fixture behind the guild-page smoke and fleet test plan:
 * one guild with ranks 0..4, a GM / delegated officer / plain member each
 * linked through a character GUID, an outsider, and a rank-1 editor grant.
 * Proven through the real `/plugins/wow/guilds/:id` access matrix.
 */
import { inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';
import { ALL_WOW_GAME_SLUGS } from '../plugins/wow-common/manifest';
import type { SeedGuildResponse } from './demo-test-guild.controller';

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

/** Seed with the integration seed's own WoW game. */
async function seedGuild(name: string): Promise<SeedGuildResponse> {
  const res = await seed({ name, gameSlug: testApp.seed.game.slug });
  expect(res.status).toBe(200);
  return res.body as SeedGuildResponse;
}

function tokenFor(user: { userId: number; username: string }): string {
  return testApp.app
    .get(AuthService)
    .login({ id: user.userId, username: user.username, role: 'member' })
    .access_token;
}

function viewGuild(guildId: number, token: string) {
  return testApp.request
    .get(`/plugins/wow/guilds/${guildId}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
});

afterAll(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
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
      .set('Authorization', `Bearer ${tokenFor(out.users.gm)}`);
    expect(editors.body.editors).toEqual([
      expect.objectContaining({ id: out.editorId, kind: 'rank', rankIndex: 1 }),
    ]);
  });

  it.each([
    ['gm', 200, { canEdit: true, canManageEditors: true }],
    ['officer', 200, { canEdit: true, canManageEditors: false }],
    ['member', 200, { canEdit: false, canManageEditors: false }],
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
