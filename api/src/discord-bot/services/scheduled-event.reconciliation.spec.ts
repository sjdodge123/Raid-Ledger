/**
 * Tests for ScheduledEventReconciliationService (ROK-755, ROK-1332).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ScheduledEventReconciliationService } from './scheduled-event.reconciliation';
import { ScheduledEventService } from './scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CapacityStillSaturatedError } from './scheduled-event.helpers';
import * as dbHelpers from './scheduled-event.db-helpers';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  setReconcileBackoff: jest.fn().mockResolvedValue(undefined),
}));

const setReconcileBackoffMock =
  dbHelpers.setReconcileBackoff as jest.MockedFunction<
    typeof dbHelpers.setReconcileBackoff
  >;

function createSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

interface Mocks {
  service: ScheduledEventReconciliationService;
  clientService: jest.Mocked<DiscordBotClientService>;
  scheduledEventService: jest.Mocked<ScheduledEventService>;
  mockDb: { select: jest.Mock };
}

async function setupModule(): Promise<Mocks> {
  const mockDb = { select: jest.fn().mockReturnValue(createSelectChain()) };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ScheduledEventReconciliationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: jest.fn().mockReturnValue(true),
          getGuild: jest.fn().mockReturnValue({}),
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_n: string, fn: () => Promise<void>) => fn()),
        },
      },
      {
        provide: ScheduledEventService,
        useValue: {
          createScheduledEvent: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile();

  return {
    service: module.get(ScheduledEventReconciliationService),
    clientService: module.get(DiscordBotClientService),
    scheduledEventService: module.get(ScheduledEventService),
    mockDb,
  };
}

describe('ScheduledEventReconciliationService (ROK-755)', () => {
  let mocks: Mocks;

  beforeEach(async () => {
    mocks = await setupModule();
  });
  afterEach(() => jest.clearAllMocks());

  it('creates scheduled events for candidates missing them', async () => {
    const candidate = {
      id: 42,
      title: 'Weekly Raid',
      description: null,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      gameId: 1,
      isAdHoc: false,
      notificationChannelOverride: null,
      signupCount: 0,
      maxAttendees: 25,
    };
    mocks.mockDb.select.mockReturnValue(createSelectChain([candidate]));
    await mocks.service.reconcileMissingScheduledEvents();
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).toHaveBeenCalledWith(42, candidate, 1, false, null, expect.anything());
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    const result = await mocks.service.reconcileMissingScheduledEvents();
    expect(result).toBe(false);
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('skips when no guild available', async () => {
    mocks.clientService.getGuild.mockReturnValue(null);
    const result = await mocks.service.reconcileMissingScheduledEvents();
    expect(result).toBe(false);
  });

  it('skips when no candidates found', async () => {
    const result = await mocks.service.reconcileMissingScheduledEvents();
    expect(result).toBe(false);
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('continues processing remaining candidates when one fails (ROK-969)', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const candidates = [
      {
        id: 1,
        title: 'A',
        description: null,
        startTime: future,
        endTime: futureEnd,
        gameId: 1,
        isAdHoc: false,
        notificationChannelOverride: null,
        signupCount: 0,
        maxAttendees: null,
      },
      {
        id: 2,
        title: 'B',
        description: null,
        startTime: future,
        endTime: futureEnd,
        gameId: 2,
        isAdHoc: false,
        notificationChannelOverride: null,
        signupCount: 0,
        maxAttendees: null,
      },
    ];
    mocks.mockDb.select.mockReturnValue(createSelectChain(candidates));
    mocks.scheduledEventService.createScheduledEvent
      .mockRejectedValueOnce(new Error('Discord timeout'))
      .mockResolvedValueOnce(undefined);
    await mocks.service.reconcileMissingScheduledEvents();
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).toHaveBeenCalledTimes(2);
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).toHaveBeenCalledWith(
      2,
      candidates[1],
      2,
      false,
      null,
      expect.anything(),
    );
  });

  describe('ROK-1332 capacity-saturated path', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const buildCandidate = (id: number) => ({
      id,
      title: `Event ${id}`,
      description: null,
      startTime: future,
      endTime: futureEnd,
      gameId: id,
      isAdHoc: false,
      notificationChannelOverride: null,
      signupCount: 0,
      maxAttendees: null,
    });

    beforeEach(() => {
      setReconcileBackoffMock.mockClear();
    });

    it('on CapacityStillSaturatedError: writes 1h backoff to unprocessed candidates and stops iterating', async () => {
      const candidates = [
        buildCandidate(1),
        buildCandidate(2),
        buildCandidate(3),
      ];
      mocks.mockDb.select.mockReturnValue(createSelectChain(candidates));
      mocks.scheduledEventService.createScheduledEvent.mockRejectedValueOnce(
        new CapacityStillSaturatedError(7),
      );

      await mocks.service.reconcileMissingScheduledEvents();

      // Stopped after first candidate's CapacityStillSaturatedError.
      expect(
        mocks.scheduledEventService.createScheduledEvent,
      ).toHaveBeenCalledTimes(1);
      // setReconcileBackoff called once with all 3 ids (none processed) and an
      // expiresAt ≈ now + 1h.
      expect(setReconcileBackoffMock).toHaveBeenCalledTimes(1);
      const [, ids, expiresAt] = setReconcileBackoffMock.mock.calls[0];
      expect(ids).toEqual([1, 2, 3]);
      const diff = expiresAt.getTime() - Date.now();
      const oneHourMs = 60 * 60 * 1000;
      expect(diff).toBeGreaterThan(oneHourMs - 5 * 60 * 1000);
      expect(diff).toBeLessThan(oneHourMs + 5 * 60 * 1000);
    });

    it('on CapacityStillSaturatedError after some success: backs off only the remaining (unprocessed) candidates', async () => {
      const candidates = [
        buildCandidate(1),
        buildCandidate(2),
        buildCandidate(3),
      ];
      mocks.mockDb.select.mockReturnValue(createSelectChain(candidates));
      mocks.scheduledEventService.createScheduledEvent
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new CapacityStillSaturatedError(3));

      await mocks.service.reconcileMissingScheduledEvents();

      expect(
        mocks.scheduledEventService.createScheduledEvent,
      ).toHaveBeenCalledTimes(2);
      const [, ids] = setReconcileBackoffMock.mock.calls[0];
      // First candidate (id=1) was processed; remaining are [2, 3].
      expect(ids).toEqual([2, 3]);
    });

    it('non-CapacityStillSaturatedError still allows iteration to continue (no backoff write)', async () => {
      const candidates = [buildCandidate(1), buildCandidate(2)];
      mocks.mockDb.select.mockReturnValue(createSelectChain(candidates));
      mocks.scheduledEventService.createScheduledEvent
        .mockRejectedValueOnce(new Error('Discord timeout'))
        .mockResolvedValueOnce(undefined);

      await mocks.service.reconcileMissingScheduledEvents();

      expect(
        mocks.scheduledEventService.createScheduledEvent,
      ).toHaveBeenCalledTimes(2);
      expect(setReconcileBackoffMock).not.toHaveBeenCalled();
    });
  });

  it('processes multiple candidates', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const candidates = [
      {
        id: 1,
        title: 'A',
        description: null,
        startTime: future,
        endTime: futureEnd,
        gameId: 1,
        isAdHoc: false,
        notificationChannelOverride: null,
        signupCount: 0,
        maxAttendees: null,
      },
      {
        id: 2,
        title: 'B',
        description: null,
        startTime: future,
        endTime: futureEnd,
        gameId: 2,
        isAdHoc: false,
        notificationChannelOverride: 'ch-1',
        signupCount: 0,
        maxAttendees: null,
      },
    ];
    mocks.mockDb.select.mockReturnValue(createSelectChain(candidates));
    await mocks.service.reconcileMissingScheduledEvents();
    expect(
      mocks.scheduledEventService.createScheduledEvent,
    ).toHaveBeenCalledTimes(2);
  });
});
