/**
 * Unit tests for LineupsService.removeNomination (ROK-935).
 * Tests deletion authorization, status guards, and carried-over protection.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { LineupsService } from './lineups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';

const NOW = new Date('2026-03-22T20:00:00Z');

const mockLineup = {
  id: 1,
  status: 'building',
  targetDate: null as Date | null,
  decidedGameId: null as number | null,
  linkedEventId: null as number | null,
  createdBy: 10,
  votingDeadline: null as Date | null,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockEntry = {
  id: 100,
  lineupId: 1,
  gameId: 42,
  nominatedBy: 10,
  note: null,
  carriedOverFrom: null as number | null,
  createdAt: NOW,
};

function thenable(data: unknown[]) {
  return {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenable(data)),
    groupBy: jest.fn().mockImplementation(() => thenable(data)),
    orderBy: jest.fn().mockImplementation(() => thenable(data)),
  };
}

function makeSelectChain(overrides: {
  whereResult?: unknown[];
  limitResult?: unknown[];
  groupByResult?: unknown[];
}) {
  const defaultData = overrides.whereResult ?? [];
  const limitData = overrides.limitResult ?? defaultData;
  const groupByData = overrides.groupByResult ?? defaultData;

  const where = jest.fn().mockImplementation(() => {
    const t = thenable(defaultData);
    t.limit = jest.fn().mockImplementation(() => thenable(limitData));
    t.groupBy = jest.fn().mockImplementation(() => thenable(groupByData));
    return t;
  });

  const innerJoin2 = jest.fn().mockReturnValue({ where });
  const innerJoin1 = jest
    .fn()
    .mockReturnValue({ where, innerJoin: innerJoin2 });

  const fromResult = {
    then: thenable(defaultData).then,
    where,
    innerJoin: innerJoin1,
    orderBy: jest.fn().mockImplementation(() => thenable(defaultData)),
    limit: jest.fn().mockImplementation(() => thenable(limitData)),
    groupBy: jest.fn().mockImplementation(() => thenable(groupByData)),
  };
  const from = jest.fn().mockReturnValue(fromResult);

  return { from };
}

describe('LineupsService.removeNomination', () => {
  let service: LineupsService;
  let mockDb: Record<string, jest.Mock>;
  let mockActivityLog: { log: jest.Mock };

  function mockSelects(...chains: ReturnType<typeof makeSelectChain>[]) {
    chains.forEach((chain) => {
      mockDb.select.mockReturnValueOnce(chain);
    });
  }

  function mockDelete() {
    mockDb.delete.mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transaction: jest
        .fn()
        .mockImplementation((fn: (tx: Record<string, jest.Mock>) => unknown) =>
          fn(mockDb),
        ),
    };

    mockActivityLog = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: ActivityLogService, useValue: mockActivityLog },
        {
          provide: SettingsService,
          useValue: { get: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: LineupPhaseQueueService,
          useValue: { scheduleTransition: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<LineupsService>(LineupsService);
  });

  it('should remove own nomination', async () => {
    // findLineupById
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    // findEntry
    mockSelects(makeSelectChain({ limitResult: [mockEntry] }));
    mockDelete();

    await service.removeNomination(1, 42, {
      id: 10,
      role: 'member',
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should throw NotFoundException for missing lineup', async () => {
    mockSelects(makeSelectChain({ limitResult: [] }));

    await expect(
      service.removeNomination(999, 42, { id: 10, role: 'member' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException when not building', async () => {
    mockSelects(
      makeSelectChain({
        limitResult: [{ ...mockLineup, status: 'voting' }],
      }),
    );

    await expect(
      service.removeNomination(1, 42, { id: 10, role: 'member' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw NotFoundException when entry not found', async () => {
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    mockSelects(makeSelectChain({ limitResult: [] }));

    await expect(
      service.removeNomination(1, 42, { id: 10, role: 'member' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException for carried-over entries', async () => {
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    mockSelects(
      makeSelectChain({
        limitResult: [{ ...mockEntry, carriedOverFrom: 99 }],
      }),
    );

    await expect(
      service.removeNomination(1, 42, { id: 10, role: 'member' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw ForbiddenException when member removes others nomination', async () => {
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    mockSelects(
      makeSelectChain({
        limitResult: [{ ...mockEntry, nominatedBy: 20 }],
      }),
    );

    await expect(
      service.removeNomination(1, 42, { id: 10, role: 'member' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow operator to remove others nomination', async () => {
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    mockSelects(
      makeSelectChain({
        limitResult: [{ ...mockEntry, nominatedBy: 20 }],
      }),
    );
    mockDelete();

    await service.removeNomination(1, 42, {
      id: 10,
      role: 'operator',
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should allow admin to remove others nomination', async () => {
    mockSelects(makeSelectChain({ limitResult: [mockLineup] }));
    mockSelects(
      makeSelectChain({
        limitResult: [{ ...mockEntry, nominatedBy: 20 }],
      }),
    );
    mockDelete();

    await service.removeNomination(1, 42, {
      id: 10,
      role: 'admin',
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });
});
