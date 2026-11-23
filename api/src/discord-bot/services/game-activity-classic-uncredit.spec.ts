/**
 * ROK-2259 follow-up — a voice row takes the Classic credit from the user's
 * open raw-name presence row only once the voice row is actually stored. A
 * failed insert must leave the raw row credited, or the play is lost twice.
 * Real flush + real WoW adapter; only the DB and the overlap SQL are faked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GameActivityService } from './game-activity.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { GameTasteService } from '../../game-taste/game-taste.service';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import { ClassicActivityAttributionService } from '../../plugins/wow-common/classic-activity-attribution.service';
import {
  WOW_ANNIVERSARY_SLUG,
  WOW_FOREVER_SLUG,
} from '../../plugins/wow-common/classic-activity-attribution.helpers';
import { uncreditOpenRawClassicSessions } from '../../plugins/wow-common/classic-activity-overlap.helpers';

jest.mock('../../plugins/wow-common/classic-activity-overlap.helpers');
jest.mock('./game-activity.helpers', () => ({
  ...jest.requireActual<object>('./game-activity.helpers'),
  resolveGameNames: jest.fn(
    (_db: unknown, names: string[], cache: Map<string, number | null>) => {
      for (const name of names) cache.set(name, ANNIVERSARY);
      return Promise.resolve();
    },
  ),
}));

const uncreditRaw = jest.mocked(uncreditOpenRawClassicSessions);

const FOREVER = 11;
const ANNIVERSARY = 22;
const VOICE =
  'World of Warcraft: Burning Crusade Classic - Anniversary Edition';

let activityDb: MockDb;
let adapterDb: MockDb;

async function createService(): Promise<GameActivityService> {
  const adapter = new ClassicActivityAttributionService(
    adapterDb as unknown as PostgresJsDatabase<typeof schema>,
    { registerAdapter: jest.fn() } as unknown as PluginRegistryService,
  );
  const registry = {
    getAdaptersForExtensionPoint: () => new Map([['wow-common', adapter]]),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GameActivityService,
      { provide: DrizzleAsyncProvider, useValue: activityDb },
      { provide: CronJobService, useValue: { executeWithTracking: jest.fn() } },
      { provide: GameTasteService, useValue: { enqueueRecompute: jest.fn() } },
      { provide: PluginRegistryService, useValue: registry },
    ],
  }).compile();
  const service = module.get<GameActivityService>(GameActivityService);
  service.onApplicationShutdown();
  return service;
}

beforeEach(() => {
  uncreditRaw.mockReset().mockResolvedValue(undefined);
  activityDb = createDrizzleMock();
  activityDb.limit.mockResolvedValue([]); // no open session for the name yet
  adapterDb = createDrizzleMock();
  adapterDb.where
    .mockResolvedValueOnce([
      { id: FOREVER, slug: WOW_FOREVER_SLUG },
      { id: ANNIVERSARY, slug: WOW_ANNIVERSARY_SLUG },
    ])
    .mockResolvedValueOnce([]); // the player's characters
});

describe('GameActivityService — Classic uncredit follows the voice insert', () => {
  it('leaves the raw presence row credited when the voice insert fails', async () => {
    activityDb.values.mockRejectedValueOnce(new Error('insert failed'));
    const service = await createService();
    service.bufferStart(1, VOICE, new Date('2026-11-18T10:00:00Z'), 'voice');

    await service.flush();

    expect(uncreditRaw).not.toHaveBeenCalled();
  });

  it('uncredits the raw presence row once the voice row is stored', async () => {
    activityDb.values.mockResolvedValueOnce(undefined);
    const service = await createService();
    service.bufferStart(1, VOICE, new Date('2026-11-18T10:00:00Z'), 'voice');

    await service.flush();

    expect(activityDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, gameId: FOREVER }),
    );
    expect(uncreditRaw).toHaveBeenCalledWith(adapterDb, 1, {
      foreverId: FOREVER,
      anniversaryId: ANNIVERSARY,
    });
  });
});
