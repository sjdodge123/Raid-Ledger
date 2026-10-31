/**
 * ROK-1697: AdminSettingsController.updateOAuthConfig persists a blank
 * callback as blank, so the default is computed at read time and tracks
 * later PUBLIC_URL / DISCORD_CALLBACK_URL changes.
 */
import { BadRequestException } from '@nestjs/common';
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

describe('AdminSettingsController.testOAuthConfig (ROK-1703 D-5)', () => {
  const APP_ID = '1290017734588641280';
  const getDiscordOAuthConfig = jest.fn();
  const fetchSpy = jest.spyOn(global, 'fetch');
  let controller: AdminSettingsController;

  function basicOf(id: string, secret: string): string {
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  function sentAuth(): string {
    const init = fetchSpy.mock.calls[0]?.[1];
    return (
      ((init?.headers ?? {}) as Record<string, string>).Authorization ?? ''
    );
  }

  beforeEach(async () => {
    getDiscordOAuthConfig.mockReset();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'x' }), { status: 200 }),
    );
    const module = await Test.createTestingModule({
      controllers: [AdminSettingsController],
      providers: [
        { provide: SettingsService, useValue: { getDiscordOAuthConfig } },
        { provide: IgdbService, useValue: {} },
        { provide: DemoDataService, useValue: {} },
      ],
    }).compile();
    controller = module.get(AdminSettingsController);
  });

  afterAll(() => fetchSpy.mockRestore());

  it('with a body, tests the typed pair and never reads the saved one', async () => {
    const result = await controller.testOAuthConfig({
      clientId: APP_ID,
      clientSecret: 'typed-secret-0123456789',
    });
    expect(result.success).toBe(true);
    expect(getDiscordOAuthConfig).not.toHaveBeenCalled();
    expect(sentAuth()).toBe(basicOf(APP_ID, 'typed-secret-0123456789'));
  });

  it('without a body, tests the saved pair exactly as before', async () => {
    getDiscordOAuthConfig.mockResolvedValue({
      clientId: '111111111111111111',
      clientSecret: 'saved-secret-0123456789',
      callbackUrl: '',
    });
    const result = await controller.testOAuthConfig({});
    expect(result.success).toBe(true);
    expect(sentAuth()).toBe(
      basicOf('111111111111111111', 'saved-secret-0123456789'),
    );
  });

  it('without a body and nothing saved, says so', async () => {
    getDiscordOAuthConfig.mockResolvedValue(null);
    await expect(controller.testOAuthConfig(undefined)).resolves.toEqual({
      success: false,
      message: 'Discord OAuth is not configured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with a 400 before calling Discord', async () => {
    await expect(
      controller.testOAuthConfig({ clientId: '12', clientSecret: 's' }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
