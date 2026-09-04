/**
 * ROK-1454 D2 — the hourly sweep is the ONLY thing that knows a group died of
 * old age, so it has to say WHICH games it touched.
 *
 * The load-bearing property is de-duplication: a sweep that expires 40 rows
 * across 3 games is 3 embed edits, not 40. `expireStaleIntents` is exercised
 * for real here (it is a plain import, not a mock), so these cases pin the
 * helper's distinct-`gameIds` contract and the service's per-game emit at the
 * same time — and pin that the LOG still reports rows while the EMITS report
 * games.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { LfgExpiryService } from './lfg-expiry.service';
import { LFG_EVENTS, LFG_EXPIRY_JOB_NAME } from './lfg.constants';

const GAME_IDS = [11, 22, 33];

/** 40 expired rows spread unevenly over three games, interleaved. */
function sweptRows(): { id: number; gameId: number }[] {
  return Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    gameId: GAME_IDS[i % GAME_IDS.length],
  }));
}

describe('LfgExpiryService.expireIntents', () => {
  let service: LfgExpiryService;
  let mockDb: MockDb;
  let emitter: { emit: jest.Mock };
  let logSpy: jest.SpyInstance;
  /** What the tracked callback reported back to the cron runner. */
  let trackedResult: unknown;
  /** Flipped once the UPDATE ... RETURNING has resolved. */
  let swept: boolean;
  /** `swept` as observed at the moment each event was emitted. */
  let emittedAfterSweep: boolean[];

  /** Payload of emit #`index`, asserting the emit happened at all first. */
  const payloadAt = (index: number): Record<string, unknown> => {
    expect(emitter.emit.mock.calls.length).toBeGreaterThan(index);
    return emitter.emit.mock.calls[index][1] as Record<string, unknown>;
  };

  /** Arrange the sweep to return `rows`, recording when it settled. */
  const arrangeSweep = (rows: { id: number; gameId: number }[]): void => {
    mockDb.returning.mockImplementationOnce(() => {
      swept = true;
      return Promise.resolve(rows);
    });
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    swept = false;
    emittedAfterSweep = [];
    trackedResult = undefined;
    emitter = {
      emit: jest.fn(() => {
        emittedAfterSweep.push(swept);
        return true;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LfgExpiryService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: emitter },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest
              .fn()
              .mockImplementation(
                async (_name: string, fn: () => Promise<unknown>) => {
                  trackedResult = await fn();
                },
              ),
          },
        },
      ],
    }).compile();
    service = module.get(LfgExpiryService);
    // Scoped to THIS service's logger: `Logger.prototype` also catches Nest's
    // own "dependencies initialized" line and makes `not.toHaveBeenCalled()` lie.
    logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // E10 — the assertion that catches `gameIds` being dropped on the floor.
  it('emits one GROUP_CHANGED per DISTINCT game, not one per swept row', async () => {
    arrangeSweep(sweptRows());

    await service.expireIntents();

    expect(emitter.emit).toHaveBeenCalledTimes(GAME_IDS.length);
    expect(emitter.emit.mock.calls).toEqual([
      [LFG_EVENTS.GROUP_CHANGED, { gameId: 11, reason: 'expired' }],
      [LFG_EVENTS.GROUP_CHANGED, { gameId: 22, reason: 'expired' }],
      [LFG_EVENTS.GROUP_CHANGED, { gameId: 33, reason: 'expired' }],
    ]);
  });

  it('keeps logging the ROW count while the emits count GAMES', async () => {
    arrangeSweep(sweptRows());

    await service.expireIntents();

    expect(logSpy).toHaveBeenCalledWith('Expired 40 LFG intents');
    expect(emitter.emit).toHaveBeenCalledTimes(3);
  });

  it('emits only after the sweep UPDATE has settled', async () => {
    arrangeSweep(sweptRows());

    await service.expireIntents();

    expect(emittedAfterSweep).toEqual([true, true, true]);
  });

  it('emits nothing and reports no work when the sweep touched no rows', async () => {
    arrangeSweep([]);

    await service.expireIntents();

    expect(emitter.emit).not.toHaveBeenCalled();
    expect(trackedResult).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('carries no member count on the expired payload — the consumer re-reads', async () => {
    arrangeSweep([{ id: 1, gameId: 11 }]);

    await service.expireIntents();

    const payload = payloadAt(0);
    expect(Object.keys(payload).sort()).toEqual(['gameId', 'reason']);
  });

  it('runs the sweep under the tracked cron job name', async () => {
    arrangeSweep([]);

    await service.expireIntents();

    const cron = service['cronJobService'] as unknown as {
      executeWithTracking: jest.Mock;
    };
    expect(cron.executeWithTracking).toHaveBeenCalledWith(
      LFG_EXPIRY_JOB_NAME,
      expect.any(Function),
    );
  });
});
