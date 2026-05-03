import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { AdminGamesController } from './settings-games.controller';
import { BrandingController } from './branding.controller';
import { DemoTestCoreController } from './demo-test-core.controller';
import { DemoTestVoiceController } from './demo-test-voice.controller';
import { DemoTestScheduledEventsController } from './demo-test-scheduled-events.controller';
import { DemoTestSignupsController } from './demo-test-signups.controller';
import { DemoTestGamesController } from './demo-test-games.controller';
import { DemoTestResetController } from './demo-test-reset.controller';
import { DemoTestStandalonePollController } from './demo-test-standalone-poll.controller';
import { SlashCommandTestController } from './slash-command-test.controller';
import { ItadSettingsController } from './itad-settings.controller';
import { CommunityInsightsSettingsController } from './settings-community-insights.controller';
import { OnboardingController } from './onboarding.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { IgdbModule } from '../igdb/igdb.module';
import { DemoDataService } from './demo-data.service';
import { DemoTestService } from './demo-test.service';
import { DemoTestResetService } from './demo-test-reset.service';
import { DemoTestLineupService } from './demo-test-lineup.service';
import { SlashCommandTestService } from './slash-command-test.service';
import { LineupsModule } from '../lineups/lineups.module';
import { StandalonePollModule } from '../lineups/standalone-poll/standalone-poll.module';
import { AiChatModule } from '../discord-bot/ai-chat/ai-chat.module';
import { TasteProfileModule } from '../taste-profile/taste-profile.module';
import { CommunityInsightsModule } from '../community-insights/community-insights.module';
import { SlowQueriesModule } from '../slow-queries/slow-queries.module';
import { AiChatTestController } from './ai-chat-test.controller';

@Module({
  imports: [
    SettingsModule,
    AuthModule,
    IgdbModule,
    LineupsModule,
    StandalonePollModule,
    AiChatModule,
    TasteProfileModule,
    CommunityInsightsModule,
    SlowQueriesModule,
  ],
  controllers: [
    AdminController,
    AdminSettingsController,
    AdminGamesController,
    BrandingController,
    DemoTestCoreController,
    DemoTestVoiceController,
    DemoTestScheduledEventsController,
    DemoTestSignupsController,
    DemoTestGamesController,
    DemoTestResetController,
    DemoTestStandalonePollController,
    AiChatTestController,
    SlashCommandTestController,
    ItadSettingsController,
    CommunityInsightsSettingsController,
    OnboardingController,
  ],
  providers: [
    DemoDataService,
    DemoTestService,
    DemoTestResetService,
    DemoTestLineupService,
    SlashCommandTestService,
  ],
})
export class AdminModule {}
