/**
 * Constants and metadata for the CronJobService.
 */

/** Maximum execution history rows kept per job */
export const MAX_EXECUTIONS_PER_JOB = 50;

/** Run retention cleanup every N executions per job (reduces DB overhead) */
export const PRUNE_EVERY_N_EXECUTIONS = 50;

/** How often (ms) to flush cached last_run_at updates to the DB */
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum interval (ms) between liveness heartbeat updates for no-op runs */
export const NOOP_LIVENESS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
 * `usesAi` flags jobs that issue LLM calls so the admin UI can badge + filter
 * them at a glance (and so operators can reason about cron-path LLM spend).
 */
export interface CoreJobMetadata {
  description: string;
  category: CronCategory;
  usesAi?: boolean;
}

export const CORE_JOB_METADATA: Record<string, CoreJobMetadata> = {
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
      'Auto-starts Discord scheduled events when their start time arrives every 60 seconds',
    category: 'Events',
  },
  ScheduledEventService_completeScheduledEvents: {
    description:
      'Auto-completes Discord scheduled events past their end time every 5 minutes',
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
  IntentTokenCleanupService_cleanupExpiredTokens: {
    description:
      'Purges consumed intent tokens older than 15 minutes every 5 minutes',
    category: 'Maintenance',
  },
  SchedulingThresholdService_checkThresholds: {
    description:
      'Notifies poll organizers when unique voter count reaches the minimum vote threshold every 5 minutes',
    category: 'Notifications',
  },
  TasteProfileService_aggregateVectors: {
    description:
      'Aggregates signal data into per-user 7-axis taste vectors daily at 5:30 AM',
    category: 'Data Sync',
  },
  TasteProfileService_buildCoPlayGraph: {
    description:
      'Rebuilds the player co-play graph from voice session overlaps and shared signups daily at 5:45 AM',
    category: 'Data Sync',
  },
  TasteProfileService_weeklyIntensityRollup: {
    description: 'Rolls up weekly play intensity snapshots Sundays at 6 AM',
    category: 'Data Sync',
  },
  GameTasteService_aggregateGameVectors: {
    description: 'Recomputes per-game taste vectors daily at 06:00 UTC.',
    category: 'Data Sync',
  },
  DiscoveryCategoriesService_weeklyGenerate: {
    description:
      'Generates LLM-proposed dynamic discover categories and expires stale approved rows weekly on Sundays at midnight.',
    category: 'Data Sync',
    usesAi: true,
  },
  CommunityInsightsService_refreshSnapshot: {
    description:
      'Rebuilds the community insights snapshot (radar, engagement, churn, social graph, temporal, key insights) daily at 06:30 UTC',
    category: 'Data Sync',
  },
  LineupReminderService_checkTiebreakerReminders: {
    description:
      'DMs lineup tiebreaker participants 24h and 1h before round deadline every 5 minutes',
    category: 'Notifications',
  },
  SlowQueriesCron_appendDigest: {
    description:
      'Reads pg_stat_statements every hour and appends a top-N digest to slow-queries.log',
    category: 'Monitoring',
  },
};
