import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './drizzle/drizzle.module';
import { ConfigModule } from '@nestjs/config';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { IgdbModule } from './igdb/igdb.module';
import { EventsModule } from './events/events.module';
import { CharactersModule } from './characters/characters.module';
import { AvailabilityModule } from './availability/availability.module';
import { RedisModule } from './redis/redis.module';
import { SystemModule } from './system/system.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationModule } from './notifications/notification.module';
import { PluginHostModule } from './plugins/plugin-host/plugin-host.module';
import { WowCommonModule } from './plugins/wow-common';
import { RateLimitModule } from './throttler/throttler.module';
import { QueueModule } from './queue/queue.module';
import { RelayModule } from './relay/relay.module';
import { FeedbackModule } from './feedback/feedback.module';
import { VersionModule } from './version/version.module';
import { DiscordBotModule } from './discord-bot/discord-bot.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryEnvModule } from './sentry/sentry-env.module';
import { CronJobModule } from './cron-jobs/cron-job.module';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RateLimitModule,
    QueueModule,
    DrizzleModule,
    RedisModule,
    PluginHostModule,
    CharactersModule,
    UsersModule,
    AuthModule,
    AdminModule,
    IgdbModule,
    EventsModule,
    AvailabilityModule,
    SystemModule,
    SettingsModule,
    NotificationModule,
    WowCommonModule,
    RelayModule,
    FeedbackModule,
    VersionModule,
    DiscordBotModule,
    SentryModule.forRoot(),
    SentryEnvModule,
    CronJobModule,
    BackupModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
