import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { MagicLinkService } from './magic-link.service';
import { IntentTokenService } from './intent-token.service';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';

import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { LocalAuthController } from './local-auth.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';
import { NotificationModule } from '../notifications/notification.module';
import { CharactersModule } from '../characters/characters.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SessionCleanupService } from './session-cleanup.service';

/**
 * Auth module — core authentication logic (JWT, local auth, intent tokens).
 * Discord OAuth strategy has been extracted to DiscordModule (ROK-267).
 */
@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule,
    ConfigModule,
    DrizzleModule,
    SettingsModule,
    forwardRef(() => EventsModule),
    forwardRef(() => NotificationModule),
    CharactersModule,
    CronJobModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, LocalAuthController],
  providers: [
    AuthService,
    LocalAuthService,
    MagicLinkService,
    IntentTokenService,
    JwtStrategy,
    SessionCleanupService,
  ],
  exports: [
    AuthService,
    LocalAuthService,
    MagicLinkService,
    IntentTokenService,
  ],
})
export class AuthModule {}
