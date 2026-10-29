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
  // ROK-1957 D-9: the BG3 plugin's nightly save-history thinning.
  Bg3HistoryRetentionCron_prune: {
    description:
      'Thins Baldur’s Gate 3 save history older than 90 days to one save per play session, nightly at 05:15',
    category: 'Maintenance',
  },
  // ROK-1959 D-3: the BG3 plugin's save-picture copy into hub Galleries.
  Bg3GalleryCron_sync: {
    description:
      'Copies one save picture per closed Baldur’s Gate 3 play session into the hub Gallery, every 15 minutes',
    category: 'Data Sync',
  },
};
