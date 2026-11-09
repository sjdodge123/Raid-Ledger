/**
 * ROK-2143 — a quest import run that wrote overlay rows clears the Quest Prep
 * quest cache (24h SWR), on success and on failure; a run that wrote nothing
 * leaves it alone. The crawl and the repo are stubbed.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { SettingsService } from '../../../settings/settings.service';
import type { BlizzardAuthService } from '../blizzard-auth.service';
import type { DungeonQuestsService } from '../dungeon-quests.service';
import { QuestImportCrawl } from './forever-quest-import.crawl';
import { ForeverQuestImportService } from './forever-quest-import.service';

jest.mock('./blizzard-quest.repo', () => ({
  listStaleQuestIds: jest.fn().mockResolvedValue([]),
  upsertBlizzardQuests: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

let clearCache: jest.Mock;
let service: ForeverQuestImportService;
let runSpy: jest.SpyInstance | undefined;

function build(): ForeverQuestImportService {
  const where = jest.fn().mockResolvedValue([]);
  const db = {
    select: () => ({ from: () => ({ where }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const settings = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    isBlizzardConfigured: jest.fn().mockResolvedValue(true),
  } as unknown as SettingsService;
  const auth = {
    getAccessToken: jest.fn().mockResolvedValue('token'),
  } as unknown as BlizzardAuthService;
  clearCache = jest.fn().mockResolvedValue(undefined);
  const quests = { clearCache } as unknown as DungeonQuestsService;
  return new ForeverQuestImportService(db, settings, auth, quests);
}

/** The crawl "writes" `upserted` rows, then throws when `fail` is set. */
function stubCrawl(upserted: number, fail = false): void {
  runSpy = jest
    .spyOn(QuestImportCrawl.prototype, 'run')
    .mockImplementation(async function (this: QuestImportCrawl) {
      this.report.counts.upserted = upserted;
      if (fail) throw new Error('Blizzard 503');
      return Promise.resolve();
    });
}

async function runOnce(): Promise<void> {
  await service.start();
  const run = service.currentRun;
  if (!run) throw new Error('expected a run in flight');
  await run;
}

beforeEach(() => {
  service = build();
});

afterEach(() => runSpy?.mockRestore());

describe('ForeverQuestImportService — quest cache invalidation', () => {
  it('clears the quest cache after a successful run that wrote rows', async () => {
    stubCrawl(3);
    await runOnce();
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('clears the quest cache after a failed run that wrote rows', async () => {
    stubCrawl(2, true);
    await runOnce();
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone when the run wrote nothing', async () => {
    stubCrawl(0, true);
    await runOnce();
    expect(clearCache).not.toHaveBeenCalled();
  });
});
