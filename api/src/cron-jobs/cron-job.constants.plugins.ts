/**
 * Cron metadata for plugin-owned jobs, spread into `CORE_JOB_METADATA`
 * (split out to keep `cron-job.constants.ts` under the 300-line cap).
 * Keys match the NestJS SchedulerRegistry names (class.method format).
 */
import type { CoreJobMetadata } from './cron-job.constants';

export const PLUGIN_JOB_METADATA: Record<string, CoreJobMetadata> = {
  // ROK-1933 D5: the Valheim suggested-claim DM scan.
  ValheimClaimSuggestCron_scan: {
    description:
      'DMs the single likely owner of an unclaimed Valheim character played 10+ minutes in a live Quick Play, asking them to claim it, every 5 minutes',
    category: 'Notifications',
  },
  // ROK-1953 D5: Core's nightly Steam achievements refresh.
  SteamAppStatsProcessor_scheduledRefresh: {
    description:
      'Refreshes Steam achievements for members of game hubs whose game has Steam stats enabled, nightly at 04:30',
    category: 'Data Sync',
  },
};
