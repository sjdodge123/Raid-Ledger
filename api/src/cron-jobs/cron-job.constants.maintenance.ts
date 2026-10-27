/**
 * Cron metadata for the core `Maintenance` jobs, spread into
 * `CORE_JOB_METADATA` (split out to keep `cron-job.constants.ts` under the
 * 300-line cap). Keys match the NestJS SchedulerRegistry names (class.method
 * format).
 */
import type { CoreJobMetadata } from './cron-job.constants';

export const MAINTENANCE_JOB_METADATA: Record<string, CoreJobMetadata> = {
  SessionCleanupService_cleanupExpiredSessions: {
    description: 'Deletes expired sessions daily at 3 AM',
    category: 'Maintenance',
  },
  LfgExpiryService_expireIntents: {
    description: 'Marks past-expiry LFG intents as expired every hour at :15',
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
  BackupService_dailyBackup: {
    description:
      'Creates a pg_dump backup and rotates backups older than 30 days',
    category: 'Maintenance',
  },
  IntentTokenCleanupService_cleanupExpiredTokens: {
    description:
      'Purges consumed intent tokens older than 15 minutes every 5 minutes',
    category: 'Maintenance',
  },
  RefreshTokenCleanupService_cleanupExpiredTokens: {
    description: 'Deletes expired and revoked refresh-token rows daily at 3 AM',
    category: 'Maintenance',
  },
  CompanionDeviceLinkCleanupService_purgeExpiredLinks: {
    description:
      'Deletes Companion device-link codes that expired over 24 hours ago, daily at 4:20 AM',
    category: 'Maintenance',
  },
  TieExpiryService_expireTieHolds: {
    description:
      'Archives community lineups whose tie hold ran out its week, undecided, daily at 05:40 UTC',
    category: 'Maintenance',
  },
  GuildReconciliationService_reconcileGuildMembers: {
    description:
      'Cross-references DB users against Discord guild membership and deactivates users no longer in the guild — daily at 07:00 UTC',
    category: 'Maintenance',
  },
  GameRoleReconcileService_reconcile: {
    description:
      "Adds each linked game's Discord role to members who played it within the window and removes bot-granted roles from idle members — daily at 07:30 UTC",
    category: 'Maintenance',
  },
};
