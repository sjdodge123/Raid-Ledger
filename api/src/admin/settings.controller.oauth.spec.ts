/**
 * ROK-1697: AdminSettingsController.updateOAuthConfig persists a blank
 * callback as blank, so the default is computed at read time and tracks
 * later PUBLIC_URL / DISCORD_CALLBACK_URL changes.
 */
import { Test } from '@nestjs/testing';
import { AdminSettingsController } from './settings.controller';
import { SettingsService } from '../settings/settings.service';
import { IgdbService } from '../igdb/igdb.service';
import { DemoDataService } from './demo-data.service';

describe('AdminSettingsController.updateOAuthConfig (ROK-1697)', () => {
  const originalPublicUrl = process.env.PUBLIC_URL;
  const setDiscordOAuthConfig = jest.fn().mockResolvedValue(undefined);
  let controller: AdminSettingsController;

  beforeEach(async () => {
    setDiscordOAuthConfig.mockClear();
    const module = await Test.createTestingModule({
      controllers: [AdminSettingsController],
      providers: [
        { provide: SettingsService, useValue: { setDiscordOAuthConfig } },
        { provide: IgdbService, useValue: {} },
        { provide: DemoDataService, useValue: {} },
      ],
    }).compile();
    controller = module.get(AdminSettingsController);
  });

  afterEach(() => {
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = originalPublicUrl;
  });

  it('saves an omitted callback as blank, not an env snapshot', async () => {
    process.env.PUBLIC_URL = 'https://snapshot.example';
    await controller.updateOAuthConfig({ clientId: 'id', clientSecret: 's' });
    expect(setDiscordOAuthConfig).toHaveBeenCalledWith({
      clientId: 'id',
      clientSecret: 's',
      callbackUrl: '',
    });
  });

  it('saves an explicit callback verbatim', async () => {
    await controller.updateOAuthConfig({
      clientId: 'id',
      clientSecret: 's',
      callbackUrl: 'https://raid.example/api/auth/discord/callback',
    });
    expect(setDiscordOAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://raid.example/api/auth/discord/callback',
      }),
    );
  });
});
