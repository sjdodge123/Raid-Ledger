import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../../auth/auth.module';
import { SettingsModule } from '../../settings/settings.module';
import { NotificationModule } from '../../notifications/notification.module';
import { DiscordAuthStrategy } from './discord-auth.strategy';
import { DiscordAuthService } from './discord-auth.service';
import { DiscordAuthController } from './discord-auth.controller';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { DISCORD_MANIFEST } from './manifest';

@Module({
  imports: [
    AuthModule,
    PassportModule,
    ConfigModule,
    SettingsModule,
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [DiscordAuthController],
  providers: [DiscordAuthStrategy, DiscordAuthService],
  exports: [DiscordAuthStrategy, DiscordAuthService],
})
export class DiscordModule implements OnModuleInit {
  private readonly logger = new Logger(DiscordModule.name);

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly discordAuthService: DiscordAuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.pluginRegistry.registerManifest(DISCORD_MANIFEST);
    await this.pluginRegistry.ensureInstalled(DISCORD_MANIFEST.id);

    this.pluginRegistry.registerAdapter(
      EXTENSION_POINTS.AUTH_PROVIDER,
      DISCORD_MANIFEST.id,
      this.discordAuthService,
    );

    this.logger.log('Discord authentication plugin initialized');
  }
}
