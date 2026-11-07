/**
 * ROK-1928 A — `PATCH /plugins/wow/guilds/:id/blizzard-roster` against a real
 * database: editor sets the slug, non-editor 403, non-Forever 404, invalid
 * slug 400, kill switch off 403.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const url = (id: number): string => `/plugins/wow/guilds/${id}/blizzard-roster`;

let testApp: TestApp;
let adminToken: string;
let plainToken: string;
let foreverGuildId: number;
let otherGuildId: number;

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(gameId: number, name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

/** A plain member account (no editor grant) with a local login. */
async function plainLogin(): Promise<string> {
  const email = 'plain@roster.test';
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: 'plain',
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

async function setSwitch(value: 'true' | 'false'): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, value);
  settings.invalidateCache(true);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverGuildId = await insertGuild(
    await ensureGame(FOREVER_SLUG),
    'Ye Olde Guild',
  );
  otherGuildId = await insertGuild(testApp.seed.game.id, 'Retail Guild');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  plainToken = await plainLogin();
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const patch = (id: number, token: string, body: Record<string, unknown>) =>
  testApp.request
    .patch(url(id))
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('PATCH /plugins/wow/guilds/:id/blizzard-roster (ROK-1928)', () => {
  it('an editor sets the slug; the summary carries blizzardRoster', async () => {
    const res = await patch(foreverGuildId, adminToken, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(200);
    expect(res.body.blizzardRoster).toEqual({
      guildSlug: 'ye-olde-guild',
      status: null,
      syncedAt: null,
    });
    const [row] = await testApp.db
      .select({ slug: schema.guilds.guildSlug })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, foreverGuildId));
    expect(row?.slug).toBe('ye-olde-guild');
  });

  it('null clears the slug (stop syncing)', async () => {
    const res = await patch(foreverGuildId, adminToken, { guildSlug: null });
    expect(res.status).toBe(200);
    expect(res.body.blizzardRoster?.guildSlug).toBeNull();
  });

  it('a non-editor gets 403', async () => {
    const res = await patch(foreverGuildId, plainToken, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(403);
  });

  it('a non-Forever guild is 404', async () => {
    const res = await patch(otherGuildId, adminToken, {
      guildSlug: 'retail-guild',
    });
    expect(res.status).toBe(404);
  });

  it('an invalid slug is 400', async () => {
    const res = await patch(foreverGuildId, adminToken, {
      guildSlug: 'has space',
    });
    expect(res.status).toBe(400);
  });

  it('the kill switch off is 403', async () => {
    await setSwitch('false');
    try {
      const res = await patch(foreverGuildId, adminToken, {
        guildSlug: 'ye-olde-guild',
      });
      expect(res.status).toBe(403);
    } finally {
      await setSwitch('true');
    }
  });
});
