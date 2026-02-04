import { Module, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';

import { DiscordStrategy } from './discord.strategy';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { LocalAuthController } from './local-auth.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';

/**
 * Conditionally include DiscordStrategy only if credentials are configured.
 * This allows the app to start without Discord OAuth for local admin bootstrap.
 */
const discordProviders = process.env.DISCORD_CLIENT_ID ? [DiscordStrategy] : [];

if (!process.env.DISCORD_CLIENT_ID) {
  const logger = new Logger('AuthModule');
  logger.warn(
    'DISCORD_CLIENT_ID not set - Discord OAuth disabled. Use /auth/local for login.',
  );
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ConfigModule,
    DrizzleModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, LocalAuthController],
  providers: [AuthService, LocalAuthService, ...discordProviders, JwtStrategy],
  exports: [AuthService, LocalAuthService],
})
export class AuthModule {}
