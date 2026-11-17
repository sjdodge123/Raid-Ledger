/**
 * ROK-2250: with no Blizzard API keys, GET /blizzard/character-preview must
 * answer a readable 503 that Sentry's beforeSend drops — not a bare 500.
 * Drives the REAL auth service + BlizzardService behind the controller; only
 * the settings lookup is stubbed (no config stored).
 */
import { HttpException } from '@nestjs/common';
import { isIntentionalUnavailable } from '../../sentry/sentry-intentional-unavailable.helpers';
import { BlizzardAuthService } from './blizzard-auth.service';
import { BlizzardController } from './blizzard.controller';
import { BlizzardNotConfiguredError } from './blizzard-not-configured.error';
import { BlizzardService } from './blizzard.service';
import type { ForeverConfigService } from './forever-config.service';
import type { SettingsService } from '../../settings/settings.service';

function controllerWithoutBlizzardKeys(): {
  ctl: BlizzardController;
  fetchSpy: jest.SpyInstance;
} {
  const settings = {
    getBlizzardConfig: jest.fn().mockResolvedValue(null),
  } as unknown as SettingsService;
  const foreverConfig = {
    isArmoryImportEnabled: jest.fn().mockResolvedValue(true),
  } as unknown as ForeverConfigService;
  const service = new BlizzardService(new BlizzardAuthService(settings));
  const fetchSpy = jest.spyOn(global, 'fetch');
  return { ctl: new BlizzardController(service, foreverConfig), fetchSpy };
}

async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => {
      throw new Error('expected the preview to reject');
    },
    (err: unknown) => err,
  );
}

describe('GET /blizzard/character-preview without Blizzard keys (ROK-2250)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects with a readable 503 the Sentry filter drops, without calling Blizzard', async () => {
    const { ctl, fetchSpy } = controllerWithoutBlizzardKeys();
    const err = await rejectionOf(
      ctl.getCharacterPreview('Thrall', 'Area 52', 'us', 'retail'),
    );
    expect(err).toBeInstanceOf(BlizzardNotConfiguredError);
    const status = err instanceof HttpException ? err.getStatus() : null;
    const message = err instanceof HttpException ? err.message : null;
    expect({ status, message }).toEqual({
      status: 503,
      message: expect.stringContaining('Blizzard API not configured'),
    });
    expect(isIntentionalUnavailable(err)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('BlizzardNotConfiguredError', () => {
  it('is one of the intentional 503s Sentry drops', () => {
    expect(isIntentionalUnavailable(new BlizzardNotConfiguredError())).toBe(
      true,
    );
  });
});
