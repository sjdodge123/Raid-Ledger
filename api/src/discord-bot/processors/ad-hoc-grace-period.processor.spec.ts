import { AdHocGracePeriodProcessor } from './ad-hoc-grace-period.processor';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import type { Job } from 'bullmq';

describe('AdHocGracePeriodProcessor', () => {
  let processor: AdHocGracePeriodProcessor;
  let mockAdHocEventService: {
    finalizeEvent: jest.Mock;
  };

  beforeEach(() => {
    mockAdHocEventService = {
      finalizeEvent: jest.fn().mockResolvedValue(undefined),
    };

    processor = new AdHocGracePeriodProcessor(
      mockAdHocEventService as unknown as AdHocEventService,
    );
  });

  describe('process', () => {
    it('calls finalizeEvent with the correct eventId', async () => {
      const mockJob = {
        data: { eventId: 42 },
      } as Job<{ eventId: number }>;

      await processor.process(mockJob);

      expect(mockAdHocEventService.finalizeEvent).toHaveBeenCalledWith(42);
    });

    it('re-throws errors from finalizeEvent for BullMQ retry', async () => {
      const error = new Error('DB connection lost');
      mockAdHocEventService.finalizeEvent.mockRejectedValue(error);

      const mockJob = {
        data: { eventId: 99 },
      } as Job<{ eventId: number }>;

      await expect(processor.process(mockJob)).rejects.toThrow(
        'DB connection lost',
      );
    });

    it('handles non-Error throwables gracefully', async () => {
      mockAdHocEventService.finalizeEvent.mockRejectedValue('string error');

      const mockJob = {
        data: { eventId: 100 },
      } as Job<{ eventId: number }>;

      await expect(processor.process(mockJob)).rejects.toBe('string error');
    });
  });
});
