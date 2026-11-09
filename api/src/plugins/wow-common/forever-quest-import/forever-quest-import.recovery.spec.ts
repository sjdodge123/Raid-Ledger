/**
 * ROK-2143 review M1 — a stored `running` report with no run behind it (the
 * process died mid-run) settles as `failed` "interrupted": at boot, and on a
 * status read once the marker is past the stale cut-off. Also: the stale-marker
 * predicates, and a mid-run kill switch ends `failed` without a Sentry event.
 */
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { SettingsService } from '../../../settings/settings.service';
import type { BlizzardAuthService } from '../blizzard-auth.service';
import type { DungeonQuestsService } from '../dungeon-quests.service';
import { WOW_FOREVER_QUEST_IMPORT_STATUS_KEY } from '../forever.settings';
import { FOREVER_QUEST_IMPORT_OFF_MESSAGE } from './forever-quest-import-switch';
import { QuestImportCrawl } from './forever-quest-import.crawl';
import {
  FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE,
  FOREVER_QUEST_IMPORT_STALE_RUNNING_MS,
  QuestImportAbort,
  emptyQuestImportReport,
  type ForeverQuestImportReport,
} from './forever-quest-import.report';
import {
  ForeverQuestImportService,
  isDeadRunningMarker,
  isLiveRunningMarker,
} from './forever-quest-import.service';

jest.mock('./blizzard-quest.repo', () => ({
  listStaleQuestIds: jest.fn().mockResolvedValue([]),
  upsertBlizzardQuests: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const NOW = new Date('2026-11-09T12:00:00.000Z');
const store = new Map<string, string>();
let runSpy: jest.SpyInstance | undefined;

function runningReport(ageMs: number): ForeverQuestImportReport {
  return {
    ...emptyQuestImportReport(),
    status: 'running',
    runId: 'run-1',
    startedAt: new Date(NOW.getTime() - ageMs).toISOString(),
  };
}

function storeReport(report: ForeverQuestImportReport): void {
  store.set(WOW_FOREVER_QUEST_IMPORT_STATUS_KEY, JSON.stringify(report));
}

function storedReport(): ForeverQuestImportReport {
  const raw = store.get(WOW_FOREVER_QUEST_IMPORT_STATUS_KEY);
  if (raw === undefined) throw new Error('expected a stored report');
  return JSON.parse(raw) as ForeverQuestImportReport;
}

function build(): ForeverQuestImportService {
  const where = jest.fn().mockResolvedValue([]);
  const db = {
    select: () => ({ from: () => ({ where }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    isBlizzardConfigured: jest.fn().mockResolvedValue(true),
  } as unknown as SettingsService;
  const auth = {
    getAccessToken: jest.fn().mockResolvedValue('token'),
  } as unknown as BlizzardAuthService;
  const quests = {
    clearCache: jest.fn().mockResolvedValue(undefined),
  } as unknown as DungeonQuestsService;
  return new ForeverQuestImportService(db, settings, auth, quests);
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
});

afterEach(() => {
  jest.useRealTimers();
  runSpy?.mockRestore();
  runSpy = undefined;
});

describe('isLiveRunningMarker / isDeadRunningMarker', () => {
  const stale = FOREVER_QUEST_IMPORT_STALE_RUNNING_MS;

  it('a running marker younger than the cut-off is live', () => {
    expect(isLiveRunningMarker(runningReport(stale - 1), NOW)).toBe(true);
    expect(isDeadRunningMarker(runningReport(stale - 1), false, NOW)).toBe(
      false,
    );
  });

  it('a running marker at or past the cut-off is dead unless this process is busy', () => {
    expect(isLiveRunningMarker(runningReport(stale), NOW)).toBe(false);
    expect(isDeadRunningMarker(runningReport(stale), false, NOW)).toBe(true);
    expect(isDeadRunningMarker(runningReport(stale), true, NOW)).toBe(false);
  });

  it('a non-running or missing report is neither', () => {
    const done = { ...runningReport(0), status: 'succeeded' as const };
    expect(isLiveRunningMarker(done, NOW)).toBe(false);
    expect(isLiveRunningMarker(null, NOW)).toBe(false);
    expect(
      isLiveRunningMarker({ ...runningReport(0), startedAt: null }, NOW),
    ).toBe(false);
    expect(isDeadRunningMarker(done, false, NOW)).toBe(false);
  });
});

describe('ForeverQuestImportService — interrupted run recovery (M1)', () => {
  it('boot settles a stored running report (even a fresh one) as failed "interrupted"', async () => {
    storeReport(runningReport(1000));
    await build().onModuleInit();
    const settled = storedReport();
    expect(settled.status).toBe('failed');
    expect(settled.errors).toEqual([FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE]);
    expect(settled.finishedAt).toBe(NOW.toISOString());
    expect(settled.runId).toBe('run-1');
  });

  it('boot leaves a finished report untouched', async () => {
    const done = { ...runningReport(1000), status: 'succeeded' as const };
    storeReport(done);
    await build().onModuleInit();
    expect(storedReport()).toEqual(done);
  });

  it('a status read settles a stale running marker, and a new run can start', async () => {
    storeReport(runningReport(FOREVER_QUEST_IMPORT_STALE_RUNNING_MS + 1));
    const service = build();
    const status = await service.getStatus();
    expect(status.status).toBe('failed');
    expect(status.errors).toEqual([FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE]);
    expect(storedReport().status).toBe('failed');
    runSpy = jest.spyOn(QuestImportCrawl.prototype, 'run').mockResolvedValue();
    await expect(service.start()).resolves.toMatchObject({
      status: 'running',
    });
    await service.currentRun;
  });

  it('a status read keeps a live (younger) running marker as running', async () => {
    storeReport(runningReport(1000));
    expect((await build().getStatus()).status).toBe('running');
    expect(storedReport().status).toBe('running');
  });
});

describe('ForeverQuestImportService — kill switch mid-run (m3)', () => {
  it('ends failed with the off message and sends no Sentry event', async () => {
    runSpy = jest
      .spyOn(QuestImportCrawl.prototype, 'run')
      .mockImplementation(async function (this: QuestImportCrawl) {
        this.report.counts.upserted = 2;
        await Promise.resolve();
        throw new QuestImportAbort(FOREVER_QUEST_IMPORT_OFF_MESSAGE);
      });
    const service = build();
    await service.start();
    await service.currentRun;
    const report = await service.getStatus();
    expect(report.status).toBe('failed');
    expect(report.errors).toEqual([FOREVER_QUEST_IMPORT_OFF_MESSAGE]);
    expect(report.counts.upserted).toBe(2);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
