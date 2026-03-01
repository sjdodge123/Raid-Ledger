import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import type {
  AuthProvider,
  LoginMethod,
} from '../plugin-host/extension-points';

@Injectable()
export class DiscordAuthService implements AuthProvider {
  readonly providerKey = 'discord';

  constructor(private readonly settingsService: SettingsService) {}

  getLoginMethod(): LoginMethod {
    return {
      key: 'discord',
      label: 'Continue with Discord',
      icon: 'discord',
      loginPath: '/auth/discord',
      color: '#5865F2',
    };
  }

  isConfigured(): Promise<boolean> {
    return this.settingsService.isDiscordConfigured();
  }
}
