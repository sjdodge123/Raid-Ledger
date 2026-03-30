import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { AdminGamesController } from './settings-games.controller';
import { BrandingController } from './branding.controller';
import { DemoTestController } from './demo-test.controller';
import { SlashCommandTestController } from './slash-command-test.controller';
import { ItadSettingsController } from './itad-settings.controller';
import { LineupSettingsController } from './settings-lineup.controller';
import { OnboardingController } from './onboarding.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { IgdbModule } from '../igdb/igdb.module';
import { DemoDataService } from './demo-data.service';
import { DemoTestService } from './demo-test.service';
import { SlashCommandTestService } from './slash-command-test.service';
import { LineupsModule } from '../lineups/lineups.module';

@Module({
  imports: [SettingsModule, AuthModule, IgdbModule, LineupsModule],
  controllers: [
    AdminController,
    AdminSettingsController,
    AdminGamesController,
    BrandingController,
    DemoTestController,
    SlashCommandTestController,
    ItadSettingsController,
    LineupSettingsController,
    OnboardingController,
  ],
  providers: [DemoDataService, DemoTestService, SlashCommandTestService],
})
export class AdminModule {}
