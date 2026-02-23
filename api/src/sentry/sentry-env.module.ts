import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { EnvironmentSnapshotService } from './environment-snapshot.service';

@Module({
  imports: [SettingsModule],
  providers: [EnvironmentSnapshotService],
})
export class SentryEnvModule {}
