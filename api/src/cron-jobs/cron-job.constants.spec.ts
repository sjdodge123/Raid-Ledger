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

  describe('ROK-1397 follow-up', () => {
    // The @Cron shipped without this entry, so the job fell through to the
    // `meta?.category ?? 'Other'` default in cron-job.helpers and surfaced in
    // the admin panel as an undescribed "Weekly Sync" under Other — invisible
    // to an operator filtering Data Sync (found while activating the
    // Co-Optimus UA exemption).
    it('should include CooptimusSyncService_weeklySync', () => {
      const meta = CORE_JOB_METADATA['CooptimusSyncService_weeklySync'];

      expect(meta).toBeDefined();
      expect(meta.description).toEqual(expect.any(String));
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.category).toBe('Data Sync');
    });
  });
});
