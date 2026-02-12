import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { BrandingController } from './branding.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { IgdbModule } from '../igdb/igdb.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { DemoDataService } from './demo-data.service';

@Module({
  imports: [SettingsModule, AuthModule, IgdbModule, FeedbackModule],
  controllers: [AdminController, AdminSettingsController, BrandingController],
  providers: [DemoDataService],
})
export class AdminModule {}
