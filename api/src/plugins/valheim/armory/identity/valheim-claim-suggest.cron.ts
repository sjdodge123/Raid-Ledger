import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../../cron-jobs/cron-job.service';
import { ValheimClaimSuggestService } from './valheim-claim-suggest.service';

const JOB_NAME = 'ValheimClaimSuggestCron_scan';

/**
 * ROK-1933 D5 — the claim-suggestion scan, every 5 minutes. A cron, not a
 * presence-event timer: restart-safe, and `ad_hoc_participants` stays the
 * single presence truth. The 10-minute minimum age is the service's.
 */
@Injectable()
export class ValheimClaimSuggestCron {
  private readonly logger = new Logger(ValheimClaimSuggestCron.name);

  constructor(
    private readonly service: ValheimClaimSuggestService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Tracked scan; an idle tick records no execution row. */
  @Cron('0 */5 * * * *', { name: JOB_NAME })
  async scan(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      const sent = await this.service.scan(new Date());
      if (sent === 0) return false;
      this.logger.log(`Claim suggestion scan: ${sent} DM(s)`);
      return true;
    });
  }
}
