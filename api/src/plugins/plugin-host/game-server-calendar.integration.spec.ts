/**
 * Game-server calendar + status endpoints, end to end (ROK-268).
 *
 * Fake `GameServerProvider`s are registered through the REAL extension point
 * on the REAL `PluginRegistryService` of this file's Nest app (one app per
 * spec file, so nothing leaks to other files). Every case rebuilds the
 * registry + plugin rows in `beforeEach`, so the file is order-independent
 * under `--randomize`.
 *
 * Not covered here: the 5 s per-provider timeout. A deterministic version
 * would cost 5 s of real wall time per case; it is pinned with fake timers in
 * `game-server-calendar.service.spec.ts` ("provider timeout").
 */
import { Logger } from '@nestjs/common';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  GameServerCalendarResponseSchema,
  GameServerStatusResponseSchema,
  type GameServerCalendarItemDto,
  type GameServerStatusDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { at, nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from './plugin-registry.service';
import {
  EXTENSION_POINTS,
  GAME_SERVER_PROVIDER_KEY,
  type GameServerProvider,
} from './extension-points';
import type { PluginManifest } from './plugin-manifest.interface';

const SLUG_A = 'test-gs-a';
const SLUG_B = 'test-gs-b';
const SLUG_C = 'test-gs-c';
const ALL_SLUGS = [SLUG_A, SLUG_B, SLUG_C];

const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-11-08T00:00:00.000Z';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function isoAfter(hours: number): string {
  return new Date(Date.parse(FROM) + hours * HOUR_MS).toISOString();
}

type FakeMode = 'ok' | 'throw' | 'invalid' | 'leak';

interface CalendarCall {
  range: { from: Date; to: Date };
  gameIds: number[] | undefined;
}

/** A fake provider whose behaviour and recorded calls are reset per test. */
interface FakeProvider extends GameServerProvider {
  mode: FakeMode;
  readonly calendarCalls: CalendarCall[];
  readonly statusCalls: Array<number[] | undefined>;
  reset(): void;
}

interface FakeSpec {
  slug: string;
  label: string;
  serverName: string;
  gameId: number;
  item: (base: ItemBase) => GameServerCalendarItemDto;
}

type ItemBase = Pick<
  GameServerCalendarItemDto,
  'serverKey' | 'serverName' | 'gameId' | 'provider'
>;

/** What a fake returns for its current mode (fakes ignore `gameIds` on purpose). */
function fakeItems(
  spec: FakeSpec,
  mode: FakeMode,
): GameServerCalendarItemDto[] {
  const base: ItemBase = {
    serverKey: `${spec.slug}-srv`,
    serverName: spec.serverName,
    gameId: mode === 'invalid' ? -1 : spec.gameId,
    // Spoofed on purpose: the host must overwrite it with `providerLabel`.
    provider: 'spoofed-by-plugin',
  };
  const item = spec.item(base);
  if (mode !== 'leak') return [item];
  const leaked = { ...item, address: '10.0.0.5' };
  return [leaked];
}

function fakeStatuses(spec: FakeSpec, mode: FakeMode): GameServerStatusDto[] {
  return [
    {
      serverKey: `${spec.slug}-srv`,
      serverName: spec.serverName,
      gameId: mode === 'invalid' ? -1 : spec.gameId,
      provider: 'spoofed-by-plugin',
      state: 'running',
      checkedAt: FROM,
    },
  ];
}

function makeFake(spec: FakeSpec): FakeProvider {
  const fake: FakeProvider = {
    pluginSlug: spec.slug,
    providerLabel: spec.label,
    mode: 'ok',
    calendarCalls: [],
    statusCalls: [],
    reset() {
      fake.mode = 'ok';
      fake.calendarCalls.length = 0;
      fake.statusCalls.length = 0;
    },
    getCalendarItems(range, gameIds) {
      fake.calendarCalls.push({ range, gameIds });
      if (fake.mode === 'throw') {
        return Promise.reject(new Error(`${spec.slug} calendar boom`));
      }
      return Promise.resolve(fakeItems(spec, fake.mode));
    },
    getStatuses(gameIds) {
      fake.statusCalls.push(gameIds);
      if (fake.mode === 'throw') {
        return Promise.reject(new Error(`${spec.slug} status boom`));
      }
      return Promise.resolve(fakeStatuses(spec, fake.mode));
    },
  };
  return fake;
}

/** A: a window for game 7 at FROM+1h. Owned by plugin A, active. */
const fakeA = makeFake({
  slug: SLUG_A,
  label: 'Fake Panel A',
  serverName: 'Alpha',
  gameId: 7,
  item: (base) => ({
    kind: 'window',
    ...base,
    start: isoAfter(1),
    end: isoAfter(3),
    label: 'Raid window',
    source: 'schedule',
  }),
});

/** B: a restart marker for game 3 at FROM+2h. Owned by plugin B, active. */
const fakeB = makeFake({
  slug: SLUG_B,
  label: 'Fake Panel B',
  serverName: 'Bravo',
  gameId: 3,
  item: (base) => ({
    kind: 'marker',
    ...base,
    at: isoAfter(2),
    effect: 'restart',
    label: 'Nightly restart',
  }),
});

/** C: registered WITHOUT an owner; its plugin row is inactive. */
const fakeC = makeFake({
  slug: SLUG_C,
  label: 'Fake Panel C',
  serverName: 'Charlie',
  gameId: 7,
  item: (base) => ({
    kind: 'marker',
    ...base,
    at: isoAfter(4),
    effect: 'backup',
    label: 'Backup',
  }),
});

function manifest(id: string): PluginManifest {
  return {
    id,
    name: `Test game-server plugin ${id}`,
    version: '0.0.0',
    description: 'ROK-268 integration fake',
    author: { name: 'test' },
    gameSlugs: [],
    capabilities: [],
  };
}

function calendarUrl(extra = ''): string {
  return `/game-servers/calendar?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}${extra}`;
}

const NamedDataSchema = z.object({
  data: z.array(z.object({ serverName: z.string() })),
});

/** Server names of a response body, in response order (fails loudly on a bad shape). */
function serverNames(body: unknown): string[] {
  return NamedDataSchema.parse(body).data.map((entry) => entry.serverName);
}

describe('Game-server calendar + status endpoints (ROK-268, integration)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let registry: PluginRegistryService;
  let warnSpy: jest.SpyInstance;

  function getMultiAdapters(): GameServerProvider[] {
    return registry.getMultiAdapters<GameServerProvider>(
      EXTENSION_POINTS.GAME_SERVER_PROVIDER,
      GAME_SERVER_PROVIDER_KEY,
    );
  }

  function authed(url: string) {
    return testApp.request
      .get(url)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  function warnedWith(fragment: string): boolean {
    return warnSpy.mock.calls.some(([message]) =>
      String(message).includes(fragment),
    );
  }

  /** Delete our rows, re-insert A/B active + C inactive (each call refreshes the active cache). */
  async function resetPluginRows(): Promise<void> {
    await testApp.db
      .delete(schema.plugins)
      .where(inArray(schema.plugins.slug, ALL_SLUGS));
    for (const slug of ALL_SLUGS) await registry.ensureInstalled(slug);
    await registry.deactivate(SLUG_C);
  }

  /** Exactly [A(owned), B(owned), C(unowned)] under the game-server point. */
  function resetAdapters(): void {
    registry.removeAdaptersForPlugin([GAME_SERVER_PROVIDER_KEY]);
    const point = EXTENSION_POINTS.GAME_SERVER_PROVIDER;
    const key = GAME_SERVER_PROVIDER_KEY;
    registry.registerMultiAdapter(point, key, fakeA, { ownerPluginId: SLUG_A });
    registry.registerMultiAdapter(point, key, fakeB, { ownerPluginId: SLUG_B });
    registry.registerMultiAdapter(point, key, fakeC);
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    registry = testApp.app.get(PluginRegistryService);
    for (const slug of ALL_SLUGS) registry.registerManifest(manifest(slug));
  });

  beforeEach(async () => {
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await resetPluginRows();
    resetAdapters();
    for (const fake of [fakeA, fakeB, fakeC]) fake.reset();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    // Re-activating restores any adapter a case suspended (clears the suspended set).
    for (const slug of [SLUG_A, SLUG_B]) {
      if (!registry.isActive(slug)) await registry.activate(slug);
    }
    testApp.seed = await truncateAllTables(testApp.db);
  });

  afterAll(async () => {
    registry.removeAdaptersForPlugin([GAME_SERVER_PROVIDER_KEY]);
    await testApp.db
      .delete(schema.plugins)
      .where(inArray(schema.plugins.slug, ALL_SLUGS));
  });

  describe('AC1 — no providers registered', () => {
    it('returns 200 { data: [] } on both endpoints', async () => {
      await registry.deactivate(SLUG_A);
      await registry.deactivate(SLUG_B);
      // C is unowned, so deactivating its plugin cannot remove it; drop it directly.
      registry.removeAdaptersForPlugin([GAME_SERVER_PROVIDER_KEY]);
      expect(getMultiAdapters()).toHaveLength(0);

      const calendar = await authed(calendarUrl());
      const status = await authed('/game-servers/status');

      expect(calendar.status).toBe(200);
      expect(calendar.body).toEqual({ data: [] });
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ data: [] });
    });
  });

  describe('AC2 — inactive providers are never returned', () => {
    it('drops a provider whose owning plugin was deactivated (removal path)', async () => {
      await registry.deactivate(SLUG_B);

      const calendar = await authed(calendarUrl());
      const status = await authed('/game-servers/status');

      expect(calendar.status).toBe(200);
      expect(serverNames(calendar.body)).toEqual(['Alpha']);
      expect(status.status).toBe(200);
      expect(serverNames(status.body)).toEqual(['Alpha']);
      expect(fakeB.calendarCalls).toHaveLength(0);
      expect(fakeB.statusCalls).toHaveLength(0);
      // The isActive filter alone would pass the above; prove B left the registry.
      expect(getMultiAdapters()).not.toContain(fakeB);

      await registry.activate(SLUG_B);
      expect(getMultiAdapters().filter((p) => p === fakeB)).toHaveLength(1);
    });

    it('skips a still-registered provider whose plugin row is inactive (isActive filter)', async () => {
      expect(getMultiAdapters()).toContain(fakeC);
      expect(registry.isActive(SLUG_C)).toBe(false);

      const calendar = await authed(calendarUrl());
      const status = await authed('/game-servers/status');

      expect(serverNames(calendar.body)).not.toContain('Charlie');
      expect(serverNames(status.body)).not.toContain('Charlie');
      expect(fakeC.calendarCalls).toHaveLength(0);
      expect(fakeC.statusCalls).toHaveLength(0);
    });
  });

  describe('AC3 — a failing provider is logged and skipped', () => {
    it('calendar: B throws → 200 with only A, warning names B', async () => {
      fakeB.mode = 'throw';

      const res = await authed(calendarUrl());

      expect(res.status).toBe(200);
      expect(serverNames(res.body)).toEqual(['Alpha']);
      expect(warnedWith(`"${SLUG_B}" failed`)).toBe(true);
    });

    it('status: B throws → 200 with only A, warning names B', async () => {
      fakeB.mode = 'throw';

      const res = await authed('/game-servers/status');

      expect(res.status).toBe(200);
      expect(serverNames(res.body)).toEqual(['Alpha']);
      expect(warnedWith(`"${SLUG_B}" failed`)).toBe(true);
    });

    it('B returns schema-invalid data (gameId -1) → skipped and warned on both endpoints', async () => {
      fakeB.mode = 'invalid';

      const calendar = await authed(calendarUrl());
      const status = await authed('/game-servers/status');

      expect(calendar.status).toBe(200);
      expect(serverNames(calendar.body)).toEqual(['Alpha']);
      expect(status.status).toBe(200);
      expect(serverNames(status.body)).toEqual(['Alpha']);
      expect(warnedWith(`"${SLUG_B}" returned invalid data`)).toBe(true);
    });
  });

  describe('AC4 — responses parse with the contract schemas', () => {
    it('calendar: both active providers, sorted by time, provider label stamped by the host', async () => {
      const res = await authed(calendarUrl());

      expect(res.status).toBe(200);
      const body = GameServerCalendarResponseSchema.parse(res.body);
      expect(body.data.map((i) => [i.kind, i.serverName, i.provider])).toEqual([
        ['window', 'Alpha', 'Fake Panel A'],
        ['marker', 'Bravo', 'Fake Panel B'],
      ]);
    });

    it('status: both active providers, sorted by server name, label stamped', async () => {
      const res = await authed('/game-servers/status');

      expect(res.status).toBe(200);
      const body = GameServerStatusResponseSchema.parse(res.body);
      expect(body.data.map((s) => [s.serverName, s.provider])).toEqual([
        ['Alpha', 'Fake Panel A'],
        ['Bravo', 'Fake Panel B'],
      ]);
    });

    it('strips a leaked key (address) a provider adds to an item', async () => {
      fakeA.mode = 'leak';

      const res = await authed(calendarUrl());

      expect(res.status).toBe(200);
      const alpha = nonEmpty(
        (res.body.data as Array<Record<string, unknown>>).filter(
          (i) => i.serverName === 'Alpha',
        ),
        'alpha item',
      );
      expect(at(alpha, 0)).not.toHaveProperty('address');
      expect(() =>
        GameServerCalendarResponseSchema.parse(res.body),
      ).not.toThrow();
    });
  });

  describe('AC5 — query validation', () => {
    const fromMs = Date.parse(FROM);
    const iso = (ms: number) => new Date(ms).toISOString();
    const q = (from: string, to: string) =>
      `/game-servers/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => i + 1).join(',');

    it.each([
      ['missing from', `/game-servers/calendar?to=${encodeURIComponent(TO)}`],
      ['missing to', `/game-servers/calendar?from=${encodeURIComponent(FROM)}`],
      ['to before from', q(TO, FROM)],
      ['to equal to from', q(FROM, FROM)],
      ['span of 62 days + 1 ms', q(FROM, iso(fromMs + 62 * DAY_MS + 1))],
      ['from not a datetime', q('garbage', TO)],
      ['offset-less datetime', q('2026-11-01T00:00:00', TO)],
      ['non-numeric game id', calendarUrl('&gameIds=1,x')],
      ['51 distinct game ids', calendarUrl(`&gameIds=${ids(51)}`)],
    ])('calendar: %s → 400, providers not called', async (_name, url) => {
      const res = await authed(url);

      expect(res.status).toBe(400);
      expect(fakeA.calendarCalls).toHaveLength(0);
    });

    it.each([
      ['span of exactly 62 days', q(FROM, iso(fromMs + 62 * DAY_MS))],
      ['exactly 50 game ids', calendarUrl(`&gameIds=${ids(50)}`)],
    ])('calendar: %s → 200 (boundary)', async (_name, url) => {
      const res = await authed(url);

      expect(res.status).toBe(200);
      expect(fakeA.calendarCalls).toHaveLength(1);
    });

    it.each([
      ['non-numeric game id', '/game-servers/status?gameIds=1,x'],
      ['game id 0', '/game-servers/status?gameIds=0'],
      ['51 distinct game ids', `/game-servers/status?gameIds=${ids(51)}`],
    ])('status: %s → 400, providers not called', async (_name, url) => {
      const res = await authed(url);

      expect(res.status).toBe(400);
      expect(fakeA.statusCalls).toHaveLength(0);
    });
  });

  describe('AC6 — gameIds pass-through and defence filter', () => {
    it('passes deduped gameIds (order kept) and the range as Dates to the provider', async () => {
      await authed(calendarUrl('&gameIds=7,3,7'));
      await authed('/game-servers/status?gameIds=7,3,7');

      const call = at(fakeA.calendarCalls, 0);
      expect(call.gameIds).toEqual([7, 3]);
      expect(call.range.from).toBeInstanceOf(Date);
      expect(call.range.from.toISOString()).toBe(FROM);
      expect(call.range.to.toISOString()).toBe(TO);
      expect(fakeA.statusCalls).toEqual([[7, 3]]);
    });

    it('passes undefined when no gameIds is given', async () => {
      await authed(calendarUrl());
      await authed('/game-servers/status');

      expect(at(fakeA.calendarCalls, 0).gameIds).toBeUndefined();
      expect(fakeA.statusCalls).toEqual([undefined]);
    });

    it('drops items outside gameIds even when a provider returns them', async () => {
      // B ignores the filter and returns its game-3 entries anyway.
      const calendar = await authed(calendarUrl('&gameIds=7'));
      const status = await authed('/game-servers/status?gameIds=7');

      expect(fakeB.calendarCalls).toHaveLength(1);
      expect(serverNames(calendar.body)).toEqual(['Alpha']);
      expect(serverNames(status.body)).toEqual(['Alpha']);
    });
  });

  describe('AC7 — deactivate / reactivate a gameSlugs:[] plugin', () => {
    it('removes its provider on deactivate and restores it (once) on activate', async () => {
      await registry.deactivate(SLUG_A);

      expect(getMultiAdapters()).not.toContain(fakeA);
      const whileOff = await authed(calendarUrl());
      expect(serverNames(whileOff.body)).toEqual(['Bravo']);

      await registry.activate(SLUG_A);

      expect(getMultiAdapters().filter((p) => p === fakeA)).toHaveLength(1);
      const calendar = await authed(calendarUrl());
      const status = await authed('/game-servers/status');
      expect(serverNames(calendar.body)).toEqual(['Alpha', 'Bravo']);
      expect(serverNames(status.body)).toEqual(['Alpha', 'Bravo']);
    });
  });

  describe('AC8 — authentication', () => {
    it.each([
      ['calendar', calendarUrl()],
      ['status', '/game-servers/status'],
    ])('%s without a token → 401', async (_name, url) => {
      const res = await testApp.request.get(url);

      expect(res.status).toBe(401);
      expect(fakeA.calendarCalls).toHaveLength(0);
      expect(fakeA.statusCalls).toHaveLength(0);
    });

    it('a non-admin member token → 200 on both endpoints', async () => {
      const [member] = nonEmpty(
        await testApp.db
          .insert(schema.users)
          .values({
            discordId: 'local:gs-member@test.local',
            username: 'gs-member',
            role: 'member',
          })
          .returning(),
        'member',
      );
      const token = await signTestAccessToken(testApp, {
        sub: member.id,
        username: member.username,
      });

      const calendar = await testApp.request
        .get(calendarUrl())
        .set('Authorization', `Bearer ${token}`);
      const status = await testApp.request
        .get('/game-servers/status')
        .set('Authorization', `Bearer ${token}`);

      expect(calendar.status).toBe(200);
      expect(serverNames(calendar.body)).toEqual(['Alpha', 'Bravo']);
      expect(status.status).toBe(200);
      expect(serverNames(status.body)).toEqual(['Alpha', 'Bravo']);
    });
  });
});
