import { CORE_JOB_METADATA } from './cron-job.constants';

describe('CORE_JOB_METADATA', () => {
  describe('Regression: ROK-768', () => {
    it('should include VoiceAttendanceService_snapshotOnEventStart', () => {
      const meta =
        CORE_JOB_METADATA['VoiceAttendanceService_snapshotOnEventStart'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Events');
    });
  });

  describe('ROK-857', () => {
    it('should include ScheduledEventReconciliation_reconcileMissing', () => {
      const meta =
        CORE_JOB_METADATA['ScheduledEventReconciliation_reconcileMissing'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Events');
    });
  });

  describe('ROK-1163', () => {
    it('should include ActiveEventCacheService_refresh', () => {
      const meta = CORE_JOB_METADATA['ActiveEventCacheService_refresh'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Events');
    });

    it('should include AdHocReaperService_reapOrphans', () => {
      const meta = CORE_JOB_METADATA['AdHocReaperService_reapOrphans'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Events');
    });
  });

  describe('ROK-1236', () => {
    it('should include StandalonePollReminderService_runReminders', () => {
      const meta =
        CORE_JOB_METADATA['StandalonePollReminderService_runReminders'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Notifications');
    });
  });
});
