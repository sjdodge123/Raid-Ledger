import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { AdminGamesController } from './settings-games.controller';
import { BrandingController } from './branding.controller';
import { DemoTestController } from './demo-test.controller';
import { SlashCommandTestController } from './slash-command-test.controller';
import { ItadSettingsController } from './itad-settings.controller';
import { OnboardingController } from './onboarding.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { IgdbModule } from '../igdb/igdb.module';
import { DemoDataService } from './demo-data.service';
import { DemoTestService } from './demo-test.service';
import { SlashCommandTestService } from './slash-command-test.service';

@Module({
  imports: [SettingsModule, AuthModule, IgdbModule],
  controllers: [
    AdminController,
    AdminSettingsController,
    AdminGamesController,
    BrandingController,
    DemoTestController,
    SlashCommandTestController,
    ItadSettingsController,
    OnboardingController,
  ],
  providers: [DemoDataService, DemoTestService, SlashCommandTestService],
})
export class AdminModule {}
