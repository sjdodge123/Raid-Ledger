/**
 * ROK-2137 — POST /admin/test/wow/seed-guild-game-text (integration).
 *
 * The DEMO seam behind the "Changed in game" smoke: a seeded in-game report
 * must surface through the REAL editor route (`GET …/ingame-text` game
 * block), and a reseed after Keep hub text (Push) must re-raise the notice.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { SettingsService } from '../settings/settings.service';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import type { SeedGuildResponse } from './demo-test-guild.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/wow/seed-guild-game-text';
const HUB_MOTD = 'Hub MOTD';
const GAME_MOTD = 'Raid moved to Thursday';

let testApp: TestApp;
let adminToken: string;
let guild: SeedGuildResponse;

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

function fixture(body: Record<string, unknown>, token = adminToken) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function tokenFor(role: 'officer' | 'member'): Promise<string> {
  const { userId, username } = guild.users[role];
  return signTestAccessToken(testApp, {
    sub: userId,
    username,
    role: 'member',
  });
}

const textPath = (suffix = ''): string =>
  `/plugins/wow/guilds/${guild.guildId}/ingame-text${suffix}`;

async function ensureWowGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db.insert(schema.games).values({
    name: 'World of Warcraft: Forever',
    slug: WOW_FOREVER_GAME_SLUG,
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await ensureWowGame();
  await setDemoMode(true);
  const res = await testApp.request
    .post('/admin/test/wow/seed-guild')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Game Text Seam Guild', gameSlug: WOW_FOREVER_GAME_SLUG });
  expect(res.status).toBe(200);
  guild = res.body as SeedGuildResponse;
  const put = await testApp.request
    .put(textPath())
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      motd: HUB_MOTD,
      baseMotdUpdatedAt: null,
    });
  expect(put.status).toBe(200);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/wow/seed-guild-game-text guards', () => {
  it('is 403 with DEMO_MODE off', async () => {
    await setDemoMode(false);
    try {
      const res = await fixture({ guildId: guild.guildId, motd: GAME_MOTD });
      expect(res.status).toBe(403);
    } finally {
      await setDemoMode(true);
    }
  });

  it('is 403 for a non-admin, 400 without motd/info, 404 for an unknown guild', async () => {
    const member = await tokenFor('member');
    expect(
      (await fixture({ guildId: guild.guildId, motd: GAME_MOTD }, member))
        .status,
    ).toBe(403);
    expect((await fixture({ guildId: guild.guildId })).status).toBe(400);
    expect(
      (await fixture({ guildId: 99_999_999, motd: GAME_MOTD })).status,
    ).toBe(404);
  });
});

describe('POST /admin/test/wow/seed-guild-game-text writes', () => {
  async function gameMotd(): Promise<unknown> {
    const res = await testApp.request
      .get(textPath())
      .set('Authorization', `Bearer ${await tokenFor('officer')}`);
    expect(res.status).toBe(200);
    return (res.body as { game?: { motd: unknown } }).game?.motd;
  }

  it('stores the report so the editor sees changedInGame, and a reseed after Push re-raises it', async () => {
    const seeded = await fixture({ guildId: guild.guildId, motd: GAME_MOTD });
    expect(seeded.status).toBe(200);
    expect(seeded.body).toMatchObject({
      guildId: guild.guildId,
      game: { motd: GAME_MOTD, motdAcked: false, info: null },
    });
    expect(await gameMotd()).toMatchObject({
      gameText: GAME_MOTD,
      changedInGame: true,
    });

    const push = await testApp.request
      .post(textPath('/motd/push'))
      .set('Authorization', `Bearer ${await tokenFor('officer')}`);
    expect(push.status).toBe(200);
    expect(await gameMotd()).toMatchObject({ changedInGame: false });

    expect(
      (await fixture({ guildId: guild.guildId, motd: GAME_MOTD })).status,
    ).toBe(200);
    expect(await gameMotd()).toMatchObject({
      gameText: GAME_MOTD,
      changedInGame: true,
    });
  });
});
