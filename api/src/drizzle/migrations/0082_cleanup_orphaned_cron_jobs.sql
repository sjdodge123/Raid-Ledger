-- Delete orphaned cron jobs with UUID names (missing @Cron name parameter)
-- These were created by SteamSyncProcessor which lacked an explicit name,
-- causing NestJS to generate a random UUID on each app boot.
DELETE FROM cron_job_executions
WHERE cron_job_id IN (
  SELECT id FROM cron_jobs WHERE name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-'
);

DELETE FROM cron_jobs WHERE name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-';

-- Add category column for job classification (replaces frontend-only hardcoded mapping)
ALTER TABLE "cron_jobs" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'Other';

-- Backfill categories for existing core jobs
UPDATE cron_jobs SET category = 'Data Sync' WHERE name IN (
  'IgdbService_handleScheduledSync',
  'GameActivityService_dailyRollup',
  'SteamSyncProcessor_scheduledSync'
);
UPDATE cron_jobs SET category = 'Notifications' WHERE name IN (
  'EventReminderService_handleReminders',
  'EventReminderService_handleDayOfReminders',
  'EmbedSchedulerService_handleScheduledEmbeds',
  'PostEventReminderService_handlePostEventReminders',
  'RecruitmentReminderService_checkAndSendReminders',
  'LiveNoShowService_checkNoShows'
);
UPDATE cron_jobs SET category = 'Monitoring' WHERE name IN (
  'RelayService_handleHeartbeat',
  'VersionCheckService_handleCron'
);
UPDATE cron_jobs SET category = 'Maintenance' WHERE name IN (
  'SessionCleanupService_cleanupExpiredSessions',
  'NotificationService_cleanupExpiredNotifications',
  'GameActivityService_sweepStaleSessions',
  'BackupService_dailyBackup'
);
UPDATE cron_jobs SET category = 'Events' WHERE name IN (
  'ScheduledEventService_startScheduledEvents',
  'EventAutoExtendService_checkExtensions',
  'VoiceAttendanceService_classifyCompletedEvents'
);
-- Plugin jobs get 'Plugin' category
UPDATE cron_jobs SET category = 'Plugin' WHERE source = 'plugin' AND category = 'Other';
