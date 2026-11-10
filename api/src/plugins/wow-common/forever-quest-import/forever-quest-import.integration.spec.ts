/**
 * ROK-2143 — WoW: Forever quest import admin routes against a real DB:
 * `POST /admin/plugins/blizzard/forever-quests/import` (202 / 409 / 403) runs
 * the crawl in the background into `wow_dungeon_quest_blizzard`;
 * `GET .../import` returns the report. Blizzard is stubbed via
 * `global.fetch` (OAuth token included) and the request spacing via
 * `ForeverQuestImportService.pause` — no real network calls, no real waits.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type * as SentryNest from '@sentry/nestjs';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from '../forever.settings';
import { FOREVER_QUEST_IMPORT_OFF_MESSAGE } from './forever-quest-import-switch';
import {
  FOREVER_QUEST_IMPORT_RUNNING_CODE,
  FOREVER_QUEST_IMPORT_RUNNING_MESSAGE,
  FOREVER_QUEST_IMPORT_UNCONFIGURED_MESSAGE,
  ForeverQuestImportService,
} from './forever-quest-import.service';

/** Spy on the real exports (the per-worker app may already hold them). */
const sentryExports = jest.requireActual<typeof SentryNest>('@sentry/nestjs');

const ROUTE = '/admin/plugins/blizzard/forever-quests/import';
/** A quest of ours (Stockade) that quest/area/717 does not list. */
const UNLISTED_ID = 990387;
const REQUIREMENTS = { prerequisite_quests: [{ id: 100 }], min_level: 22 };

let testApp: TestApp;
let adminToken: string;
let fetchSpy: jest.SpyInstance;
let captureException: jest.SpyInstance;
/** Per-test overrides: path fragment → [status, body]. */
let overrides: Map<string, [number, unknown]>;
/** When set, quest/index waits on it (holds a run open). */
let indexGate: Promise<void> | null;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const QUEST_378 = {
  id: 378,
  title: 'The Fury Runs Deep',
  type: { id: 81, name: 'Dungeon' },
  area: { id: 717, name: 'The Stockade' },
  requirements: REQUIREMENTS,
  rewards: {
    experience: 5750,
    money: { value: 1800 },
    items: { items: [{ item: { id: 918, name: 'Deviate Hide Pack' } }] },
    reputations: [{ reward: { id: 47, name: 'Ironforge' }, value: 150 }],
  },
  _links: { self: { href: 'x' } },
};

const BASE: Record<string, unknown> = {
  'quest/index': { areas: [{ id: 717, name: 'The Stockade' }] },
  'quest/area/717': {
    quests: [
      { id: 378, name: 'The Fury Runs Deep' },
      { id: 386, name: 'Gone' },
    ],
  },
  'quest/378?': QUEST_378,
  'quest/100?': {
    id: 100,
    title: 'Prereq',
    area: { id: 12, name: 'Elwynn Forest' },
  },
  [`quest/${UNLISTED_ID}?`]: {
    id: UNLISTED_ID,
    title: 'Elsewhere',
    area: { id: 40, name: 'Westfall' },
  },
  'item/918?namespace=static-classic1x-us': { id: 918, level: 25 },
};

async function respond(url: string): Promise<Response> {
  if (url.includes('battle.net/oauth/token')) {
    return json({ access_token: 't', expires_in: 3600 });
  }
  if (url.includes('quest/index') && indexGate) await indexGate;
  for (const [frag, [status, body]] of overrides) {
    if (url.includes(frag)) return json(body, status);
  }
  const hit = Object.entries(BASE).find(([frag]) => url.includes(frag));
  return hit ? json(hit[1]) : json({}, 404);
}

const service = (): ForeverQuestImportService =>
  testApp.app.get(ForeverQuestImportService);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function startAndFinish(): Promise<void> {
  const res = await testApp.request.post(ROUTE).set(auth(adminToken));
  expect(res.status).toBe(202);
  await service().currentRun;
}

async function overlayRow(questId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.wowDungeonQuestBlizzard)
    .where(eq(schema.wowDungeonQuestBlizzard.questId, questId));
  return row;
}

async function memberToken(username: string): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
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

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  overrides = new Map();
  indexGate = null;
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) =>
      respond(input instanceof Request ? input.url : input.toString()),
    );
  jest.spyOn(service(), 'pause').mockResolvedValue(undefined);
  captureException = jest
    .spyOn(sentryExports, 'captureException')
    .mockImplementation(() => '');
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await testApp.app
    .get(SettingsService)
    .setBlizzardConfig({ clientId: 'cid', clientSecret: 'secret' });
  await testApp.db
    .insert(schema.wowClassicDungeonQuests)
    .values({
      questId: UNLISTED_ID,
      dungeonInstanceId: 238,
      name: 'Elsewhere',
      expansion: 'classic',
    })
    .onConflictDoNothing();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  await service().currentRun;
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET /admin/plugins/blizzard/forever-quests/import (ROK-2143)', () => {
  it('returns an idle report with the full shape before any run', async () => {
    const res = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      mismatchedAreas: [],
      requirementKeyPaths: [],
      staleQuestIds: [],
      errors: [],
    });
    expect(res.body.counts).toEqual(expect.objectContaining({ upserted: 0 }));
  });
});

describe('POST /admin/plugins/blizzard/forever-quests/import (ROK-2143)', () => {
  it('202, then the run upserts listed, unlisted and prerequisite quests', async () => {
    await startAndFinish();
    const { body } = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(body.status).toBe('succeeded');
    expect(typeof body.finishedAt).toBe('string');
    expect(body.mismatchedAreas).toHaveLength(18);
    expect(body.mismatchedAreas).toContainEqual(
      expect.objectContaining({
        instanceId: 63,
        areaId: 1581,
        actualName: null,
      }),
    );
    expect(body.unlistedQuests).toContainEqual({
      questId: UNLISTED_ID,
      areaId: 40,
    });
    expect(body.requirementKeyPaths.length).toBeGreaterThan(0);
    expect(body.itemLevelProbe).toEqual({
      itemId: 918,
      httpStatus: 200,
      itemLevel: 25,
    });
    expect(body.errors).toContain('quest/386: HTTP 404');
    expect(body.counts).toMatchObject({
      areasImported: 1,
      questsListed: 2,
      prerequisitesFetched: 1,
    });

    const fury = await overlayRow(378);
    expect(fury).toMatchObject({
      areaId: 717,
      dungeonInstanceId: 238,
      rewardXp: 5750,
      rewardMoneyCopper: 1800,
      rewardItems: [{ id: 918, name: 'Deviate Hide Pack' }],
      reputations: [{ factionId: 47, name: 'Ironforge', value: 150 }],
      requirementsRaw: REQUIREMENTS,
      runId: body.runId,
    });
    expect(fury?.raw).not.toHaveProperty('_links');
    expect(await overlayRow(100)).toMatchObject({
      dungeonInstanceId: null,
      areaId: 12,
    });
    expect(await overlayRow(UNLISTED_ID)).toMatchObject({
      dungeonInstanceId: 238,
      areaId: 40,
    });
  });

  it('a re-run updates rows in place (new fetched_at + run_id) and flags stale ones', async () => {
    await startAndFinish();
    const first = await overlayRow(378);
    overrides.set('quest/378?', [200, { ...QUEST_378, requirements: null }]);
    await startAndFinish();
    const second = await overlayRow(378);
    const { body } = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(second?.runId).toBe(body.runId);
    expect(second?.runId).not.toBe(first?.runId);
    expect(second?.fetchedAt.getTime()).toBeGreaterThan(
      first?.fetchedAt.getTime() ?? Infinity,
    );
    const rows = await testApp.db.select().from(schema.wowDungeonQuestBlizzard);
    expect(rows.filter((r) => r.questId === 378)).toHaveLength(1);
    expect(body.staleQuestIds).toEqual([100]);
  });

  it('409 while a run is in progress', async () => {
    let release: () => void = () => undefined;
    indexGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await testApp.request.post(ROUTE).set(auth(adminToken));
    expect(first.status).toBe(202);
    const running = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(running.body.status).toBe('running');
    const second = await testApp.request.post(ROUTE).set(auth(adminToken));
    expect(second.status).toBe(409);
    expect(second.body.message).toBe(FOREVER_QUEST_IMPORT_RUNNING_MESSAGE);
    expect(second.body.code).toBe(FOREVER_QUEST_IMPORT_RUNNING_CODE);
    release();
    await service().currentRun;
  });

  it('409 with clear copy when Blizzard is not configured', async () => {
    await testApp.app
      .get(SettingsService)
      .delete(SETTING_KEYS.BLIZZARD_CLIENT_ID);
    const res = await testApp.request.post(ROUTE).set(auth(adminToken));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(FOREVER_QUEST_IMPORT_UNCONFIGURED_MESSAGE);
    expect(res.body.code).toBeUndefined();
  });

  it('403 with the off copy when the kill switch is off', async () => {
    await testApp.app
      .get(SettingsService)
      .set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false');
    const res = await testApp.request.post(ROUTE).set(auth(adminToken));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(FOREVER_QUEST_IMPORT_OFF_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('403 for a non-admin on both routes', async () => {
    const token = await memberToken('quest-import-member');
    expect((await testApp.request.post(ROUTE).set(auth(token))).status).toBe(
      403,
    );
    expect((await testApp.request.get(ROUTE).set(auth(token))).status).toBe(
      403,
    );
  });

  it('a 429 ends the run failed, keeps what was written, tags Sentry', async () => {
    overrides.set('quest/386?', [429, {}]);
    await startAndFinish();
    const { body } = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(body.status).toBe('failed');
    expect(body.errors).toContain('quest/386: HTTP 429');
    expect(await overlayRow(378)).toMatchObject({ runId: body.runId });
    expect(await overlayRow(UNLISTED_ID)).toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { context: 'wow-forever-quest-import' },
      }),
    );
  });
});
