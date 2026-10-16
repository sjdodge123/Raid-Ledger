import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CronRegistrar } from '../plugin-host/extension-points';
import type { CronJobDefinition } from '../plugin-host/extension-types';
import { PELICAN_STATUS_CRON, PELICAN_SYNC_CRON } from './pelican.constants';
import { PelicanStatusService } from './pelican-status.service';
import { PelicanSyncService } from './pelican-sync.service';
import { PelicanPresenceSupervisor } from './presence/pelican-presence.supervisor';

/**
 * Pelican cron jobs (ROK-1772): `pelican:server-sync` every 15 min and
 * `pelican:status-poll` every 2 min. Registered with `ownerPluginId`, so the
 * registry suspends them while the plugin is inactive (D8); both services
 * also re-check `isActive` themselves. Handlers never throw. The status poll
 * also reconciles the presence supervisor (ROK-1800).
 */
@Injectable()
export class PelicanCronRegistrar implements CronRegistrar {
  constructor(
    private readonly sync: PelicanSyncService,
    private readonly status: PelicanStatusService,
    // Explicit token: a `T | null` param emits `Object` metadata, which
    // `@Optional()` silently resolves to null (ROK-1800 Codex r2).
    @Optional()
    @Inject(PelicanPresenceSupervisor)
    private readonly presence: PelicanPresenceSupervisor | null = null,
  ) {}

  getCronJobs(): CronJobDefinition[] {
    return [
      {
        name: 'server-sync',
        cronExpression: PELICAN_SYNC_CRON,
        handler: async () => {
          await this.sync.syncServers();
        },
      },
      {
        name: 'status-poll',
        cronExpression: PELICAN_STATUS_CRON,
        handler: async () => {
          await this.status.pollStatuses();
          // ROK-1800: start/stop console sessions on the fresh power states.
          await this.presence?.reconcile();
        },
      },
    ];
  }
}
