import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { MagicLinkService } from './magic-link.service';
import { IntentTokenService } from './intent-token.service';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';

import { DynamicDiscordStrategy } from './dynamic-discord.strategy';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { LocalAuthController } from './local-auth.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';
import { NotificationModule } from '../notifications/notification.module';
import { CharactersModule } from '../characters/characters.module';

/**
 * Auth module with dynamic Discord OAuth support.
 * Discord strategy now loads config from database via SettingsService,
 * allowing hot-reload without container restarts.
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
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
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
    DynamicDiscordStrategy,
    JwtStrategy,
  ],
  exports: [
    AuthService,
    LocalAuthService,
    MagicLinkService,
    IntentTokenService,
    DynamicDiscordStrategy,
  ],
})
export class AuthModule {}
