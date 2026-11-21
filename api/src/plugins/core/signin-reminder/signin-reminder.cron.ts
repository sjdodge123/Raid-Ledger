/**
 * ROK-2284 — Core's sign-in reminder tick, hourly on the hour. Pausing the
 * job on the Jobs page or turning SIGNIN_REMINDER_ENABLED off stops every send.
 * Declared as `SigninReminderCron_tick` under `core` in HUB_PLUGIN_MANIFESTS.
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { SIGNIN_REMINDER_JOB_NAME } from './signin-reminder.constants';
import { SigninReminderService } from './signin-reminder.service';

@Injectable()
export class SigninReminderCron {
  constructor(
    private readonly reminders: SigninReminderService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** `false` = a no-op tick (switch off, bot offline, nobody due). */
  @Cron('0 0 * * * *', { name: 'SigninReminderCron_tick' })
  async tick(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      SIGNIN_REMINDER_JOB_NAME,
      async () => {
        const outcome = await this.reminders.runTick(new Date());
        return outcome.status === 'ran' && outcome.sent + outcome.failed > 0;
      },
    );
  }
}
