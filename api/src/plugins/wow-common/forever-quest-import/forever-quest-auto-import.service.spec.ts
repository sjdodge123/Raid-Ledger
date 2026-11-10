/**
 * ROK-2162 — ForeverQuestAutoImportService unit: the empty-overlay check, the
 * gates (plugin / switch / keys) and the overlap guard (an overlapping
 * trigger is skipped, never queued or thrown). Review r1: kicks only in the
 * HTTP server (M1), the 1h floor after a failed automatic run (m1), a failed
 * last run re-triggers (m2), pre-run failures reach Sentry (m3).
 */
import {
  ConflictException,
  ForbiddenException,
  type INestApplication,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import type { ForeverQuestImportReport } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FOREVER_QUEST_AUTO_IMPORT_KICKS,
  ForeverQuestAutoImportService,
} from './forever-quest-auto-import.service';
import {
  FOREVER_QUEST_IMPORT_SENTRY_CONTEXT,
  emptyQuestImportReport,
} from './forever-quest-import.report';
import {
  FOREVER_QUEST_IMPORT_RUNNING_MESSAGE,
  ForeverQuestImportService,
} from './forever-quest-import.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from '../forever.settings';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const NOW = new Date('2026-11-10T12:00:00.000Z');
const MINUTE = 60 * 1000;

let overlayRows: { id: number }[];
let settingsValues: Map<string, string>;
let configured: boolean;
let active: boolean;
let lastReport: ForeverQuestImportReport;
let importer: {
  start: jest.Mock;
  getStatus: jest.Mock;
  currentRun: Promise<void> | null;
};
let db: { select: jest.Mock };
let app: INestApplication | null;

/** A finished report: `trigger` run that ended `ageMs` before NOW. */
function finished(
  status: 'failed' | 'succeeded',
  trigger: 'manual' | 'auto-empty' | 'weekly',
  ageMs: number,
): ForeverQuestImportReport {
  const at = new Date(NOW.getTime() - ageMs).toISOString();
  return {
    ...emptyQuestImportReport(),
    status,
    trigger,
    startedAt: at,
    finishedAt: at,
  };
}

/** Lets the fire-and-forget kick (all mocks resolve at once) settle. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** An application context: no HTTP adapter, as in `createApplicationContext`. */
async function build(kicks = true): Promise<ForeverQuestAutoImportService> {
  return (await compile(kicks)).get(ForeverQuestAutoImportService);
}

/** The HTTP app: `init()` runs `onApplicationBootstrap` with an adapter. */
async function buildHttp(kicks = true): Promise<ForeverQuestAutoImportService> {
  const nest = (await compile(kicks)).createNestApplication({ logger: false });
  app = nest;
  await nest.init();
  return nest.get(ForeverQuestAutoImportService);
}

async function compile(kicks: boolean): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      ForeverQuestAutoImportService,
      { provide: DrizzleAsyncProvider, useValue: db },
      {
        provide: SettingsService,
        useValue: {
          get: (k: string) => Promise.resolve(settingsValues.get(k) ?? null),
          isBlizzardConfigured: () => Promise.resolve(configured),
        },
      },
      {
        provide: PluginRegistryService,
        useValue: { isActive: () => active },
      },
      { provide: ForeverQuestImportService, useValue: importer },
      { provide: FOREVER_QUEST_AUTO_IMPORT_KICKS, useValue: kicks },
    ],
  }).compile();
}

beforeEach(() => {
  overlayRows = [];
  settingsValues = new Map();
  configured = true;
  active = true;
  lastReport = emptyQuestImportReport();
  app = null;
  jest.mocked(Sentry.captureException).mockClear();
  importer = {
    start: jest.fn().mockResolvedValue({}),
    getStatus: jest.fn(() => Promise.resolve(lastReport)),
    currentRun: null,
  };
  db = {
    select: jest.fn(() => ({
      from: () => ({ limit: () => Promise.resolve(overlayRows) }),
    })),
  };
});

afterEach(async () => {
  await app?.close();
});

describe('ForeverQuestAutoImportService.startIfEmpty (ROK-2162)', () => {
  it('starts one auto-empty run when the overlay is empty', async () => {
    const svc = await build();
    await expect(svc.startIfEmpty()).resolves.toBe(true);
    expect(importer.start).toHaveBeenCalledTimes(1);
    expect(importer.start).toHaveBeenCalledWith('auto-empty');
  });

  it('starts nothing when the overlay already has rows', async () => {
    overlayRows = [{ id: 378 }];
    const svc = await build();
    await expect(svc.startIfEmpty()).resolves.toBe(false);
    expect(importer.start).not.toHaveBeenCalled();
  });

  it.each([
    ['the plugin is inactive', () => (active = false)],
    [
      'the switch is off',
      () => settingsValues.set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false'),
    ],
    ['the Blizzard keys are missing', () => (configured = false)],
  ])('starts nothing when %s', async (_label, arrange) => {
    arrange();
    const svc = await build();
    await expect(svc.startIfEmpty()).resolves.toBe(false);
    expect(importer.start).not.toHaveBeenCalled();
  });
});

describe('ForeverQuestAutoImportService overlap guard (ROK-2162)', () => {
  it('skips (does not throw) a trigger that overlaps a running import', async () => {
    importer.start
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new ConflictException(FOREVER_QUEST_IMPORT_RUNNING_MESSAGE),
      );
    const svc = await build();
    const results = await Promise.all([
      svc.tryStart('auto-empty'),
      svc.tryStart('weekly'),
    ]);
    expect(results).toEqual([true, false]);
  });

  it('skips a run the switch turned off between the check and the start', async () => {
    importer.start.mockRejectedValueOnce(new ForbiddenException('off'));
    const svc = await build();
    await expect(svc.tryStart('weekly')).resolves.toBe(false);
  });

  it('rethrows any other start error', async () => {
    importer.start.mockRejectedValueOnce(new Error('db down'));
    const svc = await build();
    await expect(svc.tryStart('weekly')).rejects.toThrow('db down');
  });

  it('runWeekly waits for the run it started', async () => {
    let finished = false;
    importer.start.mockImplementation(() => {
      importer.currentRun = Promise.resolve().then(() => {
        finished = true;
      });
      return Promise.resolve({});
    });
    const svc = await build();
    await svc.runWeekly();
    expect(importer.start).toHaveBeenCalledWith('weekly');
    expect(finished).toBe(true);
  });
});

describe('ForeverQuestAutoImportService kicks (ROK-2162)', () => {
  it('does not query the overlay at boot or on a save when kicks are off', async () => {
    const svc = await buildHttp(false);
    svc.onApplicationBootstrap();
    svc.handleBlizzardKeysSaved();
    svc.handleForeverConfigSaved();
    await flush();
    expect(db.select).not.toHaveBeenCalled();
    expect(importer.start).not.toHaveBeenCalled();
  });

  it('the HTTP app kicks the empty check at bootstrap without waiting on it', async () => {
    const svc = await buildHttp();
    await flush();
    expect(importer.start).toHaveBeenCalledWith('auto-empty');
    expect(svc.onApplicationBootstrap()).toBeUndefined();
  });

  it('the HTTP app kicks on a keys save and a Forever config save', async () => {
    overlayRows = [{ id: 378 }];
    const svc = await buildHttp();
    await flush();
    importer.getStatus.mockClear();
    svc.handleBlizzardKeysSaved();
    svc.handleForeverConfigSaved();
    await flush();
    expect(importer.getStatus).toHaveBeenCalledTimes(2);
  });

  it('review M1: an application context (CLI script) never kicks — no check, no run, no marker', async () => {
    const svc = await build();
    svc.onApplicationBootstrap();
    svc.handleBlizzardKeysSaved();
    svc.handleForeverConfigSaved();
    await flush();
    expect(importer.getStatus).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(importer.start).not.toHaveBeenCalled();
  });
});

describe('ForeverQuestAutoImportService retry floor (ROK-2162 review m1/m2)', () => {
  it.each([
    ['auto-empty', 30 * MINUTE],
    ['weekly', 59 * MINUTE],
  ] as const)(
    'm1: skips while a failed %s run finished %d ms ago (empty table)',
    async (trigger, ageMs) => {
      lastReport = finished('failed', trigger, ageMs);
      const svc = await build();
      await expect(svc.startIfEmpty(NOW)).resolves.toBe(false);
      expect(importer.start).not.toHaveBeenCalled();
    },
  );

  it('m1: retries once the failed automatic run is over an hour old', async () => {
    lastReport = finished('failed', 'auto-empty', 61 * MINUTE);
    const svc = await build();
    await expect(svc.startIfEmpty(NOW)).resolves.toBe(true);
    expect(importer.start).toHaveBeenCalledWith('auto-empty');
  });

  it('m1: a failed MANUAL run does not arm the floor', async () => {
    lastReport = finished('failed', 'manual', 5 * MINUTE);
    const svc = await build();
    await expect(svc.startIfEmpty(NOW)).resolves.toBe(true);
  });

  it('m2: a failed last run with partial rows re-triggers an automatic run', async () => {
    overlayRows = [{ id: 378 }];
    lastReport = finished('failed', 'weekly', 2 * 60 * MINUTE);
    const svc = await build();
    await expect(svc.startIfEmpty(NOW)).resolves.toBe(true);
    expect(importer.start).toHaveBeenCalledWith('auto-empty');
  });

  it('m2: a succeeded last run with rows starts nothing', async () => {
    overlayRows = [{ id: 378 }];
    lastReport = finished('succeeded', 'weekly', 5 * MINUTE);
    const svc = await build();
    await expect(svc.startIfEmpty(NOW)).resolves.toBe(false);
    expect(importer.start).not.toHaveBeenCalled();
  });
});

describe('ForeverQuestAutoImportService Sentry (ROK-2162 review m3)', () => {
  it('a failed pre-run check in a kick is sent to Sentry', async () => {
    const boom = new Error('settings read failed');
    importer.getStatus.mockRejectedValue(boom);
    await buildHttp();
    await flush();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        tags: { context: FOREVER_QUEST_IMPORT_SENTRY_CONTEXT },
      }),
    );
  });

  it('a weekly start error is sent to Sentry and rethrown', async () => {
    const boom = new Error('db down');
    importer.start.mockRejectedValueOnce(boom);
    const svc = await build();
    await expect(svc.runWeekly()).rejects.toThrow('db down');
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        tags: { context: FOREVER_QUEST_IMPORT_SENTRY_CONTEXT },
      }),
    );
  });
});
