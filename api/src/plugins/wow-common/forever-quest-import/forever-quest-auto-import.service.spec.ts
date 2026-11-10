/**
 * ROK-2162 — ForeverQuestAutoImportService unit: the empty-overlay check, the
 * gates (plugin / switch / keys) and the overlap guard (an overlapping
 * trigger is skipped, never queued or thrown).
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FOREVER_QUEST_AUTO_IMPORT_KICKS,
  ForeverQuestAutoImportService,
} from './forever-quest-auto-import.service';
import {
  FOREVER_QUEST_IMPORT_RUNNING_MESSAGE,
  ForeverQuestImportService,
} from './forever-quest-import.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from '../forever.settings';

let overlayRows: { id: number }[];
let settingsValues: Map<string, string>;
let configured: boolean;
let active: boolean;
let importer: { start: jest.Mock; currentRun: Promise<void> | null };
let db: { select: jest.Mock };

async function build(kicks = true): Promise<ForeverQuestAutoImportService> {
  const moduleRef = await Test.createTestingModule({
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
  return moduleRef.get(ForeverQuestAutoImportService);
}

beforeEach(() => {
  overlayRows = [];
  settingsValues = new Map();
  configured = true;
  active = true;
  importer = { start: jest.fn().mockResolvedValue({}), currentRun: null };
  db = {
    select: jest.fn(() => ({
      from: () => ({ limit: () => Promise.resolve(overlayRows) }),
    })),
  };
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
    const svc = await build(false);
    svc.onApplicationBootstrap();
    svc.handleBlizzardKeysSaved();
    svc.handleForeverConfigSaved();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('boot kicks the empty check without waiting on it', async () => {
    const svc = await build();
    expect(svc.onApplicationBootstrap()).toBeUndefined();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(importer.start).toHaveBeenCalledWith('auto-empty');
  });
});
