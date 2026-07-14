import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { AdminSessionController } from './admin-session.controller';
import { AdminGamesController } from './settings-games.controller';
import { BrandingController } from './branding.controller';
import { DemoTestCoreController } from './demo-test-core.controller';
import { DemoTestDeactivationController } from './demo-test-deactivation.controller';
import { NotificationModule } from '../notifications/notification.module';
import { DISCORD_NOTIFICATION_QUEUE } from '../notifications/discord-notification.constants';
import { DemoTestVoiceController } from './demo-test-voice.controller';
import { DemoTestScheduledEventsController } from './demo-test-scheduled-events.controller';
import { DemoTestSignupsController } from './demo-test-signups.controller';
import { DemoTestGamesController } from './demo-test-games.controller';
import { DemoTestLineupController } from './demo-test-lineup.controller';
import { DemoTestGraceController } from './demo-test-grace.controller';
import { DemoTestResetController } from './demo-test-reset.controller';
import { DemoTestFixtureUserController } from './demo-test-fixture-user.controller';
import { DemoTestStandalonePollController } from './demo-test-standalone-poll.controller';
import { DemoTestRecruitmentController } from './demo-test-recruitment.controller';
import { SlashCommandTestController } from './slash-command-test.controller';
import { ItadSettingsController } from './itad-settings.controller';
import { CooptimusSettingsController } from './cooptimus-settings.controller';
import { CooptimusModule } from '../cooptimus/cooptimus.module';
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
import { GamesDedupAuditController } from './games-dedup-audit.controller';
import { GamesDedupAuditService } from './games-dedup-audit.service';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';

@Module({
  imports: [
    SettingsModule,
    CooptimusModule,
    AuthModule,
    IgdbModule,
    LineupsModule,
    StandalonePollModule,
    AiChatModule,
    TasteProfileModule,
    CommunityInsightsModule,
    SlowQueriesModule,
    forwardRef(() => NotificationModule),
    // ROK-1347: AdminController injects DiscordBotClientService for the
    // orphan-SE recovery endpoint. forwardRef guards the deep module cycle
    // DiscordBotModule → NotificationModule → … → AdminModule.
    forwardRef(() => DiscordBotModule),
    BullModule.registerQueue({ name: DISCORD_NOTIFICATION_QUEUE }),
  ],
  controllers: [
    AdminController,
    AdminSettingsController,
    AdminSessionController,
    AdminGamesController,
    BrandingController,
    DemoTestCoreController,
    DemoTestDeactivationController,
    DemoTestVoiceController,
    DemoTestScheduledEventsController,
    DemoTestSignupsController,
    DemoTestGamesController,
    DemoTestLineupController,
    DemoTestGraceController,
    DemoTestResetController,
    DemoTestFixtureUserController,
    DemoTestStandalonePollController,
    DemoTestRecruitmentController,
    AiChatTestController,
    SlashCommandTestController,
    ItadSettingsController,
    CooptimusSettingsController,
    CommunityInsightsSettingsController,
    OnboardingController,
    GamesDedupAuditController,
  ],
  providers: [
    DemoDataService,
    DemoTestService,
    DemoTestResetService,
    DemoTestLineupService,
    SlashCommandTestService,
    GamesDedupAuditService,
  ],
})
export class AdminModule {}
