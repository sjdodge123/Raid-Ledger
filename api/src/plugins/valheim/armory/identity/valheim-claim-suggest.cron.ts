import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../../cron-jobs/cron-job.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { ValheimClaimSuggestService } from './valheim-claim-suggest.service';

const JOB_NAME = 'ValheimClaimSuggestCron_scan';

/**
 * ROK-1933 D5 — the claim-suggestion scan, every 5 minutes. A cron, not a
 * presence-event timer: restart-safe, and `ad_hoc_participants` stays the
 * single presence truth. The 10-minute minimum age is the service's.
 * Codex P2: a deactivated Valheim plugin sends no DMs — the tick returns
 * before the scan (and records no execution row).
 */
@Injectable()
export class ValheimClaimSuggestCron {
  private readonly logger = new Logger(ValheimClaimSuggestCron.name);

  constructor(
    private readonly service: ValheimClaimSuggestService,
    private readonly cronJobService: CronJobService,
    private readonly registry: PluginRegistryService,
  ) {}

  /** Tracked scan; an idle tick (or an inactive plugin) records no row. */
  @Cron('0 */5 * * * *', { name: JOB_NAME })
  async scan(): Promise<void> {
    if (!this.registry.isActive(VALHEIM_PLUGIN_ID)) return;
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      const sent = await this.service.scan(new Date());
      if (sent === 0) return false;
      this.logger.log(`Claim suggestion scan: ${sent} DM(s)`);
      return true;
    });
  }
}
