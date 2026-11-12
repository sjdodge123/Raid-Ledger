/**
 * ROK-1170 — the Forever guild summary (founded date, faction, Blizzard guild
 * id, disbanded state) riding the roster sync, against the real DB with a
 * stubbed `BlizzardService`. Spec Lane 2 item 7 cases 1–13, plus the F5
 * ruling: the scheduled due-list skips a `disbanded` guild (14) and an
 * editor's Sync now on one that gets a 200 clears it (15); review follow-ups:
 * a slug changed mid-fetch writes nothing (16), a community hub omits the
 * summary (13c). Fleet-only.
 */
import type * as SentryModule from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import type { SummaryFetch } from '../blizzard-forever-guild-summary.helpers';
import { BlizzardService } from '../blizzard.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { BlizzardRosterSyncJob } from './blizzard-roster-sync.job';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';

/** Spy on the live CJS module (see `blizzard-roster-sync.integration.spec.ts`). */
const sentry = jest.requireActual<typeof SentryModule>('@sentry/nestjs');
const captureException = jest.spyOn(sentry, 'captureException');
const captureMessage = jest.spyOn(sentry, 'captureMessage');

const FOREVER_SLUG = 'world-of-warcraft-forever';
const CLASSIC_SLUG = 'world-of-warcraft-classic';
const HOUR_MS = 60 * 60 * 1000;
const FOUNDED = new Date('2024-03-05T18:30:00.000Z');

let testApp: TestApp;
let adminToken: string;
let rosterSpy: jest.SpyInstance;
let summarySpy: jest.SpyInstance;

const apiMember = (name: string): ForeverGuildMember => ({
  name,
  level: 60,
  classId: 8,
  rank: 3,
  blizzardId: null,
});
const found = (
  blizzardGuildId: number | null,
  faction: 'Alliance' | 'Horde' | null = 'Horde',
): SummaryFetch => ({
  kind: 'found',
  summary: { blizzardGuildId, foundedAt: FOUNDED, faction },
});
const NOT_FOUND: SummaryFetch = { kind: 'not_found' };
const hoursAgo = (h: number): Date => new Date(Date.now() - h * HOUR_MS);

async function ensureGame(slug: string): Promise<number> {
  const [hit] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (hit) return hit.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: `WoW ${slug}`, slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

type GuildOver = Partial<schema.GuildInsert>;

/** A Forever `wow_guild` with a slug (unique name per call), plus overrides. */
async function insertGuild(over: GuildOver = {}, slug = FOREVER_SLUG) {
  const name = `Summary ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: await ensureGame(slug),
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        guildSlug: 'night-shift',
        ...over,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

const guildRow = async (id: number) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, id)),
    'guild row',
  )[0];

/** The four summary columns plus faction, for exact before/after checks. */
const summaryCols = async (id: number) => {
  const g = await guildRow(id);
  return {
    blizzardGuildId: g.blizzardGuildId,
    foundedAt: g.foundedAt?.toISOString() ?? null,
    faction: g.faction,
    status: g.blizzardSummaryStatus,
    notFoundSince: g.blizzardNotFoundSince?.toISOString() ?? null,
  };
};

const sync = (id: number) =>
  testApp.app.get(BlizzardRosterSyncService).syncForeverGuildRoster(id);
const auth = (req: ReturnType<TestApp['request']['get']>) =>
  req.set('Authorization', `Bearer ${adminToken}`);

async function setSwitch(value: 'true' | 'false'): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, value);
  settings.invalidateCache(true);
}

/** A guild that answered 200 before: id 42, founded, Alliance, `ok`. */
const healthy = (over: GuildOver = {}): Promise<number> =>
  insertGuild({
    blizzardGuildId: 42,
    foundedAt: FOUNDED,
    faction: 'Alliance',
    blizzardSummaryStatus: 'ok',
    ...over,
  });

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(async () => {
  await setSwitch('true');
  captureException.mockClear();
  captureMessage.mockClear();
  const blizzard = testApp.app.get(BlizzardService);
  // Empty roster → `skipped_empty`: settled, nothing written to members.
  rosterSpy = jest
    .spyOn(blizzard, 'fetchForeverGuildRoster')
    .mockResolvedValue({ members: [] });
  summarySpy = jest
    .spyOn(blizzard, 'fetchForeverGuildSummary')
    .mockResolvedValue(found(42));
});

afterEach(async () => {
  rosterSpy.mockRestore();
  summarySpy.mockRestore();
  await setSwitch('true');
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-1170 — summary 200', () => {
  it('(1) writes id, founded and faction with status ok', async () => {
    const id = await insertGuild({ faction: 'Alliance' });
    await sync(id);
    expect(summarySpy).toHaveBeenCalledWith('night-shift', 'us');
    expect(await summaryCols(id)).toEqual({
      blizzardGuildId: 42,
      foundedAt: FOUNDED.toISOString(),
      faction: 'Horde',
      status: 'ok',
      notFoundSince: null,
    });
  });

  it('(6) a 200 after disbanded clears it to ok with since null', async () => {
    const id = await healthy({
      blizzardSummaryStatus: 'disbanded',
      blizzardNotFoundSince: hoursAgo(10),
    });
    await sync(id);
    const cols = await summaryCols(id);
    expect(cols.status).toBe('ok');
    expect(cols.notFoundSince).toBeNull();
  });

  it('(7) an id change writes nothing but error and fires Sentry', async () => {
    const id = await healthy({ foundedAt: null });
    const before = await summaryCols(id);
    summarySpy.mockResolvedValue(found(99, 'Horde'));
    await sync(id);
    expect(await summaryCols(id)).toEqual({ ...before, status: 'error' });
    expect(captureMessage).toHaveBeenCalledWith(
      'Forever guild summary id mismatch',
      expect.objectContaining({
        tags: { guildId: String(id), region: 'us' },
      }),
    );
  });

  it('(10) a second identical run is idempotent', async () => {
    const id = await insertGuild();
    await sync(id);
    const first = await summaryCols(id);
    await sync(id);
    expect(await summaryCols(id)).toEqual(first);
  });
});

describe('ROK-1170 — summary 404 two-strike', () => {
  it('(2) one 404 after a 200 is not_found with since set, nothing else changed', async () => {
    const id = await healthy();
    const before = await summaryCols(id);
    summarySpy.mockResolvedValue(NOT_FOUND);
    const t0 = Date.now();
    await sync(id);
    const after = await summaryCols(id);
    expect(after).toEqual({
      ...before,
      status: 'not_found',
      notFoundSince: expect.any(String),
    });
    const since = Date.parse(after.notFoundSince ?? '');
    expect(since).toBeGreaterThanOrEqual(t0 - 1000);
    expect(since).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('(3) a second 404 at least 6h after the first is disbanded', async () => {
    const since = hoursAgo(7);
    const id = await healthy({
      blizzardSummaryStatus: 'not_found',
      blizzardNotFoundSince: since,
    });
    summarySpy.mockResolvedValue(NOT_FOUND);
    await sync(id);
    expect(await summaryCols(id)).toMatchObject({
      status: 'disbanded',
      notFoundSince: since.toISOString(),
    });
  });

  it('(4) a second 404 under 6h stays not_found, since unchanged', async () => {
    const since = hoursAgo(1);
    const id = await healthy({
      blizzardSummaryStatus: 'not_found',
      blizzardNotFoundSince: since,
    });
    summarySpy.mockResolvedValue(NOT_FOUND);
    await sync(id);
    expect(await summaryCols(id)).toMatchObject({
      status: 'not_found',
      notFoundSince: since.toISOString(),
    });
  });

  it('(5) a never-200 slug stays not_found on every 404', async () => {
    const id = await insertGuild();
    summarySpy.mockResolvedValue(NOT_FOUND);
    for (let i = 0; i < 3; i += 1) {
      await sync(id);
      expect(await summaryCols(id)).toMatchObject({
        blizzardGuildId: null,
        status: 'not_found',
        notFoundSince: null,
      });
    }
  });
});

describe('ROK-1170 — summary vs roster independence (AC6)', () => {
  it('(8) a summary 502 leaves the roster result and status unchanged', async () => {
    const id = await insertGuild();
    rosterSpy.mockResolvedValue({
      members: [apiMember('Ana'), apiMember('Bo')],
    });
    summarySpy.mockRejectedValue(new Error('Blizzard 502'));
    expect(await sync(id)).toEqual({ status: 'ok', updated: 0, inserted: 2 });
    const g = await guildRow(id);
    expect(g.blizzardRosterStatus).toBe('ok');
    expect(g.blizzardSummaryStatus).toBe('error');
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Blizzard 502' }),
      { tags: { guildId: String(id), region: 'us' } },
    );
  });

  it('(9) a roster 404 still runs the summary', async () => {
    const id = await insertGuild();
    rosterSpy.mockResolvedValue(null);
    expect(await sync(id)).toEqual({ status: 'not_found' });
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect((await guildRow(id)).blizzardSummaryStatus).toBe('ok');
  });

  it('(11) with the kill switch off nothing is fetched', async () => {
    const id = await insertGuild();
    await setSwitch('false');
    expect(await sync(id)).toEqual({ status: 'disabled' });
    expect(rosterSpy).not.toHaveBeenCalled();
    expect(summarySpy).not.toHaveBeenCalled();
    expect((await guildRow(id)).blizzardSummaryStatus).toBeNull();
  });
});

describe('ROK-1170 — slug change and page DTO', () => {
  it('(12) a slug PATCH resets the four summary columns', async () => {
    const id = await healthy({
      blizzardSummaryStatus: 'not_found',
      blizzardNotFoundSince: hoursAgo(2),
    });
    const res = await auth(
      testApp.request.patch(`/plugins/wow/guilds/${id}/blizzard-roster`),
    ).send({ guildSlug: 'day-shift' });
    expect(res.status).toBe(200);
    expect(res.body.blizzardGuild).toEqual({ foundedAt: null, state: null });
    expect(await summaryCols(id)).toEqual({
      blizzardGuildId: null,
      foundedAt: null,
      faction: 'Alliance',
      status: null,
      notFoundSince: null,
    });
  });

  it('(13a) the Forever hub page carries blizzardGuild', async () => {
    const id = await healthy({ blizzardSummaryStatus: 'disbanded' });
    const res = await auth(testApp.request.get(`/plugins/wow/guilds/${id}`));
    expect(res.status).toBe(200);
    expect(res.body.guild.blizzardGuild).toEqual({
      foundedAt: FOUNDED.toISOString(),
      state: 'disbanded',
    });
  });

  it('(13b) a Classic wow_guild page omits blizzardGuild', async () => {
    const id = await insertGuild(
      { foundedAt: FOUNDED, blizzardSummaryStatus: 'ok' },
      CLASSIC_SLUG,
    );
    const res = await auth(testApp.request.get(`/plugins/wow/guilds/${id}`));
    expect(res.status).toBe(200);
    expect(res.body.guild).not.toHaveProperty('blizzardGuild');
  });
});

describe('ROK-1170 — slug race and community hub', () => {
  it('(16) a slug changed between fetch and write writes nothing', async () => {
    const id = await insertGuild();
    summarySpy.mockImplementation(async () => {
      await testApp.db
        .update(schema.guilds)
        .set({ guildSlug: 'day-shift' })
        .where(eq(schema.guilds.id, id));
      return found(42);
    });
    await sync(id);
    expect(summarySpy).toHaveBeenCalledWith('night-shift', 'us');
    expect((await guildRow(id)).guildSlug).toBe('day-shift');
    expect(await summaryCols(id)).toMatchObject({
      blizzardGuildId: null,
      foundedAt: null,
      status: null,
      notFoundSince: null,
    });
  });

  it('(13c) a Forever game_community hub page omits blizzardGuild', async () => {
    const id = await insertGuild({
      kind: 'game_community',
      source: 'community',
      guildSlug: null,
      foundedAt: FOUNDED,
      blizzardSummaryStatus: 'ok',
    });
    const res = await auth(testApp.request.get(`/plugins/wow/guilds/${id}`));
    expect(res.status).toBe(200);
    expect(res.body.guild.kind).toBe('game_community');
    expect(res.body.guild).not.toHaveProperty('blizzardGuild');
  });
});

describe('ROK-1170 F5 — a disbanded guild leaves the scheduled sync', () => {
  it('(14) the due list skips disbanded but keeps null and not_found', async () => {
    const gone = await healthy({ blizzardSummaryStatus: 'disbanded' });
    const fresh = await insertGuild();
    const missing = await healthy({ blizzardSummaryStatus: 'not_found' });
    const due = await testApp.app.get(BlizzardRosterSyncJob).listDueGuildIds();
    expect(due).not.toContain(gone);
    expect(due).toEqual(expect.arrayContaining([fresh, missing]));
  });

  it('(15) Sync now on a disbanded guild that gets a 200 clears it to ok', async () => {
    const id = await healthy({
      blizzardSummaryStatus: 'disbanded',
      blizzardNotFoundSince: hoursAgo(12),
    });
    const res = await auth(
      testApp.request.post(`/plugins/wow/guilds/${id}/blizzard-roster/sync`),
    );
    expect(res.status).toBe(200);
    expect(summarySpy).toHaveBeenCalledWith('night-shift', 'us');
    expect(await summaryCols(id)).toMatchObject({
      status: 'ok',
      notFoundSince: null,
    });
  });
});
