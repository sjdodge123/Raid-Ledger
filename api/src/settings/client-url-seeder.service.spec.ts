/**
 * ROK-1627 — the boot-time `CLIENT_URL` seeder.
 *
 * It may only ever write a value it resolved from a trusted anchor, and may
 * only ever overwrite a value it wrote itself — a deployer-supplied env var is
 * authoritative forever.
 */
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SETTING_KEYS } from '../drizzle/schema';
import { ClientUrlSeederService } from './client-url-seeder.service';
import { SettingsService } from './settings.service';

type SettingsMock = { get: jest.Mock };

const CALLBACK = 'https://raid.example/auth/discord/callback';

describe('ClientUrlSeederService', () => {
  const originalClientUrl = process.env.CLIENT_URL;
  const originalCallbackUrl = process.env.DISCORD_CALLBACK_URL;
  let service: ClientUrlSeederService;
  let settings: SettingsMock;
  let warn: jest.SpyInstance;

  /** Resolve settings-backed anchors from a key→value map. */
  function stubSettings(values: Partial<Record<string, string>>): void {
    settings.get.mockImplementation((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
  }

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    delete process.env.DISCORD_CALLBACK_URL;
    settings = { get: jest.fn().mockResolvedValue(null) };
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        ClientUrlSeederService,
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(ClientUrlSeederService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;
    if (originalCallbackUrl === undefined) delete process.env.DISCORD_CALLBACK_URL;
    else process.env.DISCORD_CALLBACK_URL = originalCallbackUrl;
  });

  it('seeds CLIENT_URL from the discord callback setting when it is unset', async () => {
    stubSettings({ [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://raid.example');
  });

  it('treats an empty-string CLIENT_URL (the allinone image default) as unset', async () => {
    process.env.CLIENT_URL = '';
    stubSettings({ [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://raid.example');
  });

  it('never overwrites a deployer-supplied CLIENT_URL', async () => {
    process.env.CLIENT_URL = 'https://deployer.example';
    stubSettings({ [SETTING_KEYS.CLIENT_URL]: 'https://settings.example' });
    await service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://deployer.example');
  });

  it('re-seeds on OAUTH_DISCORD_UPDATED when it owns the current value', async () => {
    stubSettings({ [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await service.onApplicationBootstrap();
    stubSettings({
      [SETTING_KEYS.DISCORD_CALLBACK_URL]:
        'https://configured.example/auth/discord/callback',
    });
    await service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBe('https://configured.example');
  });

  it('leaves a deployer value alone on OAUTH_DISCORD_UPDATED', async () => {
    await service.onApplicationBootstrap();
    process.env.CLIENT_URL = 'https://deployer.example';
    stubSettings({ [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBe('https://deployer.example');
  });

  it('leaves CLIENT_URL unset and warns once when nothing is trusted', async () => {
    await service.onApplicationBootstrap();
    await service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/CLIENT_URL/);
  });

  it('seeds from the DISCORD_CALLBACK_URL env var when no setting exists', async () => {
    process.env.DISCORD_CALLBACK_URL = 'https://env.example/auth/callback';
    await service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://env.example');
    expect(warn).not.toHaveBeenCalled();
  });
});
