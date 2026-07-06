import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';
import { UsersService } from './users.service';
import { UsersModerationService } from './users-moderation.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { GuildReconciliationService } from './guild-reconciliation.service';
import { UsersController } from './users.controller';
import { UsersMeController } from './users-me.controller';
import { UsersManagementController } from './users-management.controller';
import { UsersModerationController } from './users-moderation.controller';
import { CharactersModule } from '../characters/characters.module';
import { EventsModule } from '../events/events.module';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';
import { NotificationModule } from '../notifications/notification.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { TokenBlocklistService } from '../auth/token-blocklist.service';

@Module({
  imports: [
    forwardRef(() => CharactersModule),
    EventsModule,
    forwardRef(() => DiscordBotModule),
    forwardRef(() => NotificationModule),
    CronJobModule,
    MulterModule.register({ storage: multer.memoryStorage() }),
  ],
  controllers: [
    UsersMeController,
    UsersManagementController,
    UsersModerationController,
    UsersController,
  ],
  providers: [
    UsersService,
    UsersModerationService,
    AvatarService,
    PreferencesService,
    GameTimeService,
    GuildReconciliationService,
    TokenBlocklistService,
  ],
  exports: [UsersService, AvatarService, PreferencesService, GameTimeService],
})
export class UsersModule {}
