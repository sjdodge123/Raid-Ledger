import { Test } from '@nestjs/testing';
import { RunningLateService } from './running-late.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

describe('RunningLateService (ROK-1379)', () => {
  let service: RunningLateService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    const module = await Test.createTestingModule({
      providers: [
        RunningLateService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();
    service = module.get(RunningLateService);
  });

  describe('setRunningLate', () => {
    it('marks the attendee late and reports the change', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      const changed = await service.setRunningLate(1, 7);
      expect(changed).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ runningLateAt: expect.any(Date) }),
      );
    });

    it('is a no-op when no signup row matches (already late or host with no signup)', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      const changed = await service.setRunningLate(1, 7);
      expect(changed).toBe(false);
    });

    it('is idempotent — a second call updates nothing', async () => {
      mockDb.returning
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);
      expect(await service.setRunningLate(1, 7)).toBe(true);
      expect(await service.setRunningLate(1, 7)).toBe(false);
    });
  });

  describe('clearRunningLate', () => {
    it('clears the marker and reports the change', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      const changed = await service.clearRunningLate(1, 7);
      expect(changed).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ runningLateAt: null, lateMinutes: null }),
      );
    });

    it('is a no-op when not currently late', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      expect(await service.clearRunningLate(1, 7)).toBe(false);
    });
  });
});
