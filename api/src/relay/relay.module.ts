import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { RelayService } from './relay.service';
import { RelayBootstrapService } from './relay-bootstrap.service';
import { RelayController } from './relay.controller';

@Module({
  imports: [SettingsModule, CronJobModule],
  controllers: [RelayController],
  providers: [RelayService, RelayBootstrapService],
  exports: [RelayService],
})
export class RelayModule {}
