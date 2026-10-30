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
import { PLATFORM_PUBLIC_URL_VARS } from './client-url.helpers';
import { SettingsService } from './settings.service';

type SettingsMock = { get: jest.Mock };

interface Harness {
  service: ClientUrlSeederService;
  settings: SettingsMock;
  warn: jest.SpyInstance;
  log: jest.SpyInstance;
}

const CALLBACK = 'https://raid.example/auth/discord/callback';

/** Build the service over a stub SettingsService, with the logger silenced. */
async function createHarness(): Promise<Harness> {
  const settings: SettingsMock = { get: jest.fn().mockResolvedValue(null) };
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  const module = await Test.createTestingModule({
    providers: [
      ClientUrlSeederService,
      { provide: SettingsService, useValue: settings },
    ],
  }).compile();
  return { service: module.get(ClientUrlSeederService), settings, warn, log };
}

/** Resolve settings-backed anchors from a key→value map. */
function stubSettings(
  settings: SettingsMock,
  values: Partial<Record<string, string>>,
): void {
  settings.get.mockImplementation((key: string) =>
    Promise.resolve(values[key] ?? null),
  );
}

/** Clear the env vars this suite mutates, and put them back afterwards. */
function useCleanEnv(...names: string[]): void {
  const original = names.map((name) => [name, process.env[name]] as const);
  beforeEach(() => names.forEach((name) => delete process.env[name]));
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

describe('ClientUrlSeederService', () => {
  let h: Harness;

  useCleanEnv(
    'CLIENT_URL',
    'DISCORD_CALLBACK_URL',
    ...PLATFORM_PUBLIC_URL_VARS,
  );

  beforeEach(async () => {
    h = await createHarness();
  });

  it('seeds CLIENT_URL from the discord callback setting when it is unset', async () => {
    stubSettings(h.settings, { [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await h.service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://raid.example');
  });

  it('treats an empty-string CLIENT_URL (the allinone image default) as unset', async () => {
    process.env.CLIENT_URL = '';
    stubSettings(h.settings, { [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await h.service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://raid.example');
  });

  it('never overwrites a deployer-supplied CLIENT_URL', async () => {
    process.env.CLIENT_URL = 'https://deployer.example';
    stubSettings(h.settings, {
      [SETTING_KEYS.CLIENT_URL]: 'https://settings.example',
    });
    await h.service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://deployer.example');
  });

  it('re-seeds on OAUTH_DISCORD_UPDATED when it owns the current value', async () => {
    stubSettings(h.settings, { [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await h.service.onApplicationBootstrap();
    stubSettings(h.settings, {
      [SETTING_KEYS.DISCORD_CALLBACK_URL]:
        'https://configured.example/auth/discord/callback',
    });
    await h.service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBe('https://configured.example');
  });

  it('leaves a deployer value alone on OAUTH_DISCORD_UPDATED', async () => {
    await h.service.onApplicationBootstrap();
    process.env.CLIENT_URL = 'https://deployer.example';
    stubSettings(h.settings, { [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await h.service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBe('https://deployer.example');
  });

  it('leaves CLIENT_URL unset and warns once when nothing is trusted', async () => {
    await h.service.onApplicationBootstrap();
    await h.service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBeUndefined();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toMatch(/CLIENT_URL/);
  });

  it('withdraws its own seed when the configured source is removed', async () => {
    stubSettings(h.settings, { [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK });
    await h.service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://raid.example');
    stubSettings(h.settings, {});
    await h.service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBeUndefined();
  });

  it('never removes a deployer value when the configured source is removed', async () => {
    process.env.CLIENT_URL = 'https://deployer.example';
    await h.service.onApplicationBootstrap();
    await h.service.onDiscordOAuthUpdated();
    expect(process.env.CLIENT_URL).toBe('https://deployer.example');
  });

  it('survives a failed settings read at boot and on the event', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    h.settings.get.mockRejectedValue(new Error('db down'));
    await expect(h.service.onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(h.service.onDiscordOAuthUpdated()).resolves.toBeUndefined();
    expect(process.env.CLIENT_URL).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('seeds from the DISCORD_CALLBACK_URL env var when no setting exists', async () => {
    process.env.DISCORD_CALLBACK_URL = 'https://env.example/auth/callback';
    await h.service.onApplicationBootstrap();
    expect(process.env.CLIENT_URL).toBe('https://env.example');
    expect(h.warn).not.toHaveBeenCalled();
  });

  describe('platform public URL — lowest-trust anchor (ROK-1697)', () => {
    /** Messages logged at `log` level that start with `public URL:`. */
    const publicUrlLines = (): unknown[] =>
      h.log.mock.calls
        .map((call: unknown[]) => call[0])
        .filter((m) => typeof m === 'string' && m.startsWith('public URL:'));

    it('seeds CLIENT_URL from PUBLIC_URL when no other anchor exists', async () => {
      process.env.PUBLIC_URL = 'https://public.example/';
      await h.service.onApplicationBootstrap();
      expect(process.env.CLIENT_URL).toBe('https://public.example');
      expect(h.warn).not.toHaveBeenCalled();
    });

    it('lets the discord callback setting outrank the platform URL', async () => {
      process.env.RENDER_EXTERNAL_URL = 'https://rl.onrender.com';
      stubSettings(h.settings, {
        [SETTING_KEYS.DISCORD_CALLBACK_URL]: CALLBACK,
      });
      await h.service.onApplicationBootstrap();
      expect(process.env.CLIENT_URL).toBe('https://raid.example');
    });

    it('lets DISCORD_CALLBACK_URL outrank the platform URL (fleet envs)', async () => {
      process.env.PUBLIC_URL = 'https://public.example';
      process.env.DISCORD_CALLBACK_URL =
        'https://slot-1.example/api/auth/discord/callback';
      await h.service.onApplicationBootstrap();
      expect(process.env.CLIENT_URL).toBe('https://slot-1.example');
    });

    it('never overwrites a deployer CLIENT_URL with the platform URL', async () => {
      process.env.CLIENT_URL = 'https://deployer.example';
      process.env.PUBLIC_URL = 'https://public.example';
      await h.service.onApplicationBootstrap();
      expect(process.env.CLIENT_URL).toBe('https://deployer.example');
    });

    it('logs exactly one public URL line naming its source at boot', async () => {
      process.env.FLY_APP_NAME = 'raid-ledger';
      await h.service.onApplicationBootstrap();
      expect(publicUrlLines()).toEqual([
        'public URL: https://raid-ledger.fly.dev (from FLY_APP_NAME)',
      ]);
    });

    it('logs "public URL: unresolved" when no source is set', async () => {
      await h.service.onApplicationBootstrap();
      expect(publicUrlLines()).toEqual(['public URL: unresolved']);
    });

    it('warns about an unusable source and falls through to the next', async () => {
      process.env.PUBLIC_URL = 'javascript:alert(1)';
      process.env.APP_URL = 'https://do.example';
      await h.service.onApplicationBootstrap();
      expect(h.warn).toHaveBeenCalledWith(
        'Ignoring PUBLIC_URL="javascript:alert(1)": not an http(s) URL',
      );
      expect(publicUrlLines()).toEqual([
        'public URL: https://do.example (from APP_URL)',
      ]);
      expect(process.env.CLIENT_URL).toBe('https://do.example');
    });
  });
});
