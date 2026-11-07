/**
 * ROK-1928 §E "C integration" — `POST /plugins/wow/guilds/:id/blizzard-roster/sync`
 * against a real database with a stubbed `BlizzardService`: 200 summary,
 * concurrent second call 409, kill switch off 403, no slug 404. Fleet-only.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import type {
  ForeverGuildMember,
  ForeverGuildRoster,
} from '../blizzard-forever-guild.helpers';
import { BlizzardService } from '../blizzard.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const syncUrl = (id: number): string =>
  `/plugins/wow/guilds/${id}/blizzard-roster/sync`;

let testApp: TestApp;
let adminToken: string;
let fetchSpy: jest.SpyInstance;

const apiMember = (name: string): ForeverGuildMember => ({
  name,
  level: 60,
  classId: 8,
  rank: 3,
  blizzardId: null,
});

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

/** A Forever guild (unique name per call), optionally with a Blizzard slug. */
async function insertGuild(guildSlug: string | null): Promise<number> {
  const name = `Sync Guild ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: await ensureGame(),
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        guildSlug,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function setSwitch(value: 'true' | 'false'): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, value);
  settings.invalidateCache(true);
}

const post = (id: number) =>
  testApp.request
    .post(syncUrl(id))
    .set('Authorization', `Bearer ${adminToken}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  fetchSpy = jest.spyOn(
    testApp.app.get(BlizzardService),
    'fetchForeverGuildRoster',
  );
});

afterEach(async () => {
  fetchSpy.mockRestore();
  await setSwitch('true');
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('POST /plugins/wow/guilds/:id/blizzard-roster/sync (ROK-1928 C3)', () => {
  it('200 with the run summary', async () => {
    const id = await insertGuild('ye-olde-guild');
    fetchSpy.mockResolvedValue({
      members: [apiMember('Ana'), apiMember('Bo')],
    } satisfies ForeverGuildRoster);
    const res = await post(id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      syncedAt: expect.any(String),
      members: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith('ye-olde-guild', 'us');
  });

  it('a second call while the first runs gets 409', async () => {
    const id = await insertGuild('busy-guild');
    let entered: () => void = () => undefined;
    const inFetch = new Promise<void>((r) => (entered = r));
    let release: (v: ForeverGuildRoster | null) => void = () => undefined;
    fetchSpy.mockImplementation(() => {
      entered();
      return new Promise<ForeverGuildRoster | null>((r) => (release = r));
    });
    const first = post(id).then((r) => r);
    await inFetch;
    const second = await post(id);
    expect(second.status).toBe(409);
    release(null);
    const done = await first;
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('not_found');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('403 with the kill-switch copy when Forever Armory import is off', async () => {
    const id = await insertGuild('off-guild');
    await setSwitch('false');
    const res = await post(id);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Armory import for WoW: Forever is turned off',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404 when the guild has no Blizzard slug', async () => {
    const id = await insertGuild(null);
    const res = await post(id);
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('502 when the Blizzard fetch fails', async () => {
    const id = await insertGuild('broken-guild');
    fetchSpy.mockRejectedValue(new Error('upstream 503'));
    const res = await post(id);
    expect(res.status).toBe(502);
  });
});
