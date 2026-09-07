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

describe('CORE_JOB_METADATA — every live @Cron job is described', () => {
  // Registry names declared via @Cron({ name }) in the codebase. A job that is
  // missing here makes extractRegistryJobMeta return null, which logs a
  // "missing CORE_JOB_METADATA entry" warning at boot and renders a blank
  // description row in Admin → Scheduled Jobs.
  const LIVE_CRON_REGISTRY_NAMES = [
    'ChannelPresenceEmbedService_reapStale',
    'EphemeralVoiceScheduler_scanNameReconcile',
    'EphemeralVoiceScheduler_scanCreateWindow',
    'EphemeralVoiceReaper_reapIdle',
    'EventReminderService_handleReminders',
    'VoiceAttendanceService_snapshotOnEventStart',
    'ActiveEventCacheService_refresh',
    'CooptimusSyncService_weeklySync',
  ];

  it.each(LIVE_CRON_REGISTRY_NAMES)(
    'has a non-empty description for %s',
    (name) => {
      expect(CORE_JOB_METADATA).toHaveProperty(name);
      const meta = CORE_JOB_METADATA[name];
      expect(meta.description.trim().length).toBeGreaterThan(0);
      expect(meta.category).toEqual(expect.any(String));
    },
  );
});
