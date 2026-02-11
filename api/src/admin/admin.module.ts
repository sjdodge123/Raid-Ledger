import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { IgdbModule } from '../igdb/igdb.module';
import { DemoDataService } from './demo-data.service';

@Module({
  imports: [SettingsModule, AuthModule, IgdbModule],
  controllers: [AdminController, AdminSettingsController],
  providers: [DemoDataService],
})
export class AdminModule {}
