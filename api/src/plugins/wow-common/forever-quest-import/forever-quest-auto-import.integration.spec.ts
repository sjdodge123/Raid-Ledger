/**
 * ROK-2162 — the Forever quest import runs on its own against a real DB:
 * an empty `wow_dungeon_quest_blizzard` + keys + switch on starts exactly one
 * `auto-empty` run; a populated table, the switch off or missing keys start
 * nothing; a failed weekly run keeps the rows; the report records the trigger.
 * The TestApp turns the boot / settings-save kicks off, so each test calls the
 * service directly. Blizzard is stubbed via `global.fetch` like
 * `forever-quest-import.integration.spec.ts`; the request spacing via `pause`.
 */
import { eq } from 'drizzle-orm';
import type * as SentryNest from '@sentry/nestjs';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from '../forever.settings';
import { ForeverQuestAutoImportService } from './forever-quest-auto-import.service';
import { ForeverQuestImportService } from './forever-quest-import.service';

const sentryExports = jest.requireActual<typeof SentryNest>('@sentry/nestjs');
const ROUTE = '/admin/plugins/blizzard/forever-quests/import';

let testApp: TestApp;
let fetchSpy: jest.SpyInstance;
let startSpy: jest.SpyInstance;
/** Per-test overrides: path fragment → [status, body]. */
let overrides: Map<string, [number, unknown]>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const BASE: Record<string, unknown> = {
  'quest/index': { areas: [{ id: 717, name: 'The Stockade' }] },
  'quest/area/717': { quests: [{ id: 378, name: 'The Fury Runs Deep' }] },
  'quest/378?': {
    id: 378,
    title: 'The Fury Runs Deep',
    area: { id: 717, name: 'The Stockade' },
    rewards: { experience: 5750, money: { value: 1800 } },
  },
};

function respond(url: string): Response {
  if (url.includes('battle.net/oauth/token')) {
    return json({ access_token: 't', expires_in: 3600 });
  }
  for (const [frag, [status, body]] of overrides) {
    if (url.includes(frag)) return json(body, status);
  }
  const hit = Object.entries(BASE).find(([frag]) => url.includes(frag));
  return hit ? json(hit[1]) : json({}, 404);
}

const auto = (): ForeverQuestAutoImportService =>
  testApp.app.get(ForeverQuestAutoImportService);
const importer = (): ForeverQuestImportService =>
  testApp.app.get(ForeverQuestImportService);
const settings = (): SettingsService => testApp.app.get(SettingsService);

async function overlayRows() {
  return testApp.db.select().from(schema.wowDungeonQuestBlizzard);
}

/** Run the empty check and wait for the run it started. */
async function autoRun(): Promise<boolean> {
  const started = await auto().startIfEmpty();
  await importer().currentRun;
  return started;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  overrides = new Map();
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) =>
      Promise.resolve(
        respond(input instanceof Request ? input.url : input.toString()),
      ),
    );
  jest.spyOn(importer(), 'pause').mockResolvedValue(undefined);
  jest.spyOn(sentryExports, 'captureException').mockImplementation(() => '');
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await settings().setBlizzardConfig({ clientId: 'cid', clientSecret: 's' });
  startSpy = jest.spyOn(importer(), 'start');
});

afterEach(async () => {
  await importer().currentRun;
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  settings().invalidateCache(true);
});

describe('Forever quest auto-import (ROK-2162)', () => {
  it('empty table + keys + switch on → exactly one auto-empty run', async () => {
    expect(await overlayRows()).toEqual([]);
    expect(await autoRun()).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith('auto-empty');
    const report = await importer().getStatus();
    expect(report).toMatchObject({
      status: 'succeeded',
      trigger: 'auto-empty',
    });
    expect(report.lastAutoRunAt).toBe(report.startedAt);
    const [row] = await testApp.db
      .select()
      .from(schema.wowDungeonQuestBlizzard)
      .where(eq(schema.wowDungeonQuestBlizzard.questId, 378));
    expect(row).toMatchObject({ rewardXp: 5750, rewardMoneyCopper: 1800 });
  });

  it('a populated table starts nothing', async () => {
    await autoRun();
    expect((await overlayRows()).length).toBeGreaterThan(0);
    startSpy.mockClear();
    expect(await autoRun()).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('the switch off starts nothing and calls no Blizzard URL', async () => {
    await settings().set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false');
    expect(await autoRun()).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('missing Blizzard keys start nothing', async () => {
    await settings().delete(SETTING_KEYS.BLIZZARD_CLIENT_ID);
    expect(await autoRun()).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a failed weekly run keeps the rows an earlier run wrote', async () => {
    await autoRun();
    const before = await overlayRows();
    expect(before.length).toBeGreaterThan(0);
    overrides.set('quest/index', [503, {}]);
    await auto().runWeekly();
    const report = await importer().getStatus();
    expect(report).toMatchObject({ status: 'failed', trigger: 'weekly' });
    const after = await overlayRows();
    expect(after.map((r) => r.questId).sort()).toEqual(
      before.map((r) => r.questId).sort(),
    );
  });

  it('a manual run records its trigger and keeps the last automatic run time', async () => {
    await autoRun();
    const autoStartedAt = (await importer().getStatus()).startedAt;
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .post(ROUTE)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(202);
    await importer().currentRun;
    const report = await importer().getStatus();
    expect(report.trigger).toBe('manual');
    expect(report.lastAutoRunAt).toBe(autoStartedAt);
  });
});
