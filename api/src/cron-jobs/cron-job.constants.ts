/**
 * Constants and metadata for the CronJobService.
 */

/** Maximum execution history rows kept per job */
export const MAX_EXECUTIONS_PER_JOB = 50;

/** Run retention cleanup every N executions per job (reduces DB overhead) */
export const PRUNE_EVERY_N_EXECUTIONS = 50;

/** How often (ms) to flush cached last_run_at updates to the DB */
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Valid categories for cron jobs. Must match the `category` column values.
 */
export type CronCategory =
  | 'Data Sync'
  | 'Notifications'
  | 'Events'
  | 'Maintenance'
  | 'Monitoring'
  | 'Other';

/**
 * Human-readable descriptions for the core @Cron jobs.
 * Keys match the NestJS SchedulerRegistry names (class.method format).
 */
export const CORE_JOB_METADATA: Record<
  string,
  { description: string; category: CronCategory }
> = {
  IgdbService_handleScheduledSync: {
    description: 'Syncs game data from IGDB every 6 hours',
    category: 'Data Sync',
  },
  EventReminderService_handleReminders: {
    description:
      'Checks for events within reminder windows and sends DM reminders every 60 seconds',
    category: 'Notifications',
  },
  EventReminderService_handleDayOfReminders: {
    description:
      'Sends day-of reminder DMs for events starting today every 60 seconds',
    category: 'Notifications',
  },
  RelayService_handleHeartbeat: {
    description: 'Sends heartbeat to the Raid Ledger relay hub every hour',
    category: 'Monitoring',
  },
  VersionCheckService_handleCron: {
    description: 'Checks GitHub for new Raid Ledger releases daily',
    category: 'Monitoring',
  },
  EmbedSchedulerService_handleScheduledEmbeds: {
    description:
      'Posts deferred Discord embeds for future series events approaching their lead-time window every 15 minutes',
    category: 'Notifications',
  },
  SessionCleanupService_cleanupExpiredSessions: {
    description: 'Deletes expired sessions daily at 3 AM',
    category: 'Maintenance',
  },
  NotificationService_cleanupExpiredNotifications: {
    description: 'Deletes expired notifications daily at 4 AM',
    category: 'Maintenance',
  },
  GameActivityService_sweepStaleSessions: {
    description:
      'Closes game activity sessions older than 24h every 15 minutes',
    category: 'Maintenance',
  },
  GameActivityService_dailyRollup: {
    description:
      'Aggregates closed game sessions into daily/weekly/monthly rollups at 5 AM',
    category: 'Data Sync',
  },
  BackupService_dailyBackup: {
    description:
      'Creates a pg_dump backup and rotates backups older than 30 days',
    category: 'Maintenance',
  },
  ScheduledEventService_startScheduledEvents: {
    description:
      'Auto-starts Discord scheduled events when their start time arrives every 30 seconds',
    category: 'Events',
  },
  ScheduledEventService_completeScheduledEvents: {
    description:
      'Auto-completes Discord scheduled events past their end time every 30 seconds',
    category: 'Events',
  },
  EventAutoExtendService_checkExtensions: {
    description:
      'Auto-extends scheduled events when voice channel activity persists past the end time every 60 seconds',
    category: 'Events',
  },
  VoiceAttendanceService_classifyCompletedEvents: {
    description:
      'Classifies attendance for completed voice events every 60 seconds',
    category: 'Events',
  },
  VoiceAttendanceService_snapshotOnEventStart: {
    description:
      'Snapshots voice channel occupants for recently started events every 60 seconds',
    category: 'Events',
  },
  LiveNoShowService_checkNoShows: {
    description:
      'Detects no-show attendees during live events and sends reminder DMs (5 min) and creator escalation (15 min) every 60 seconds',
    category: 'Notifications',
  },
  PostEventReminderService_handlePostEventReminders: {
    description:
      'Sends post-event feedback reminders after events end every 60 seconds',
    category: 'Notifications',
  },
  RecruitmentReminderService_checkAndSendReminders: {
    description:
      'DMs unsigned game followers about upcoming events every 15 minutes',
    category: 'Notifications',
  },
  SteamSyncProcessor_scheduledSync: {
    description: 'Syncs Steam library data for all linked users daily at 4 AM',
    category: 'Data Sync',
  },
  ItadPriceSyncService_syncPricing: {
    description: 'Syncs ITAD pricing data for all linked games every 4 hours',
    category: 'Data Sync',
  },
  ScheduledEventReconciliation_reconcileMissing: {
    description:
      'Creates missing Discord scheduled events for future events every 15 minutes',
    category: 'Events',
  },
};
