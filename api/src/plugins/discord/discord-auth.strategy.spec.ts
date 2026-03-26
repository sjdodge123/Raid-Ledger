import { Logger } from '@nestjs/common';
import { DiscordAuthStrategy } from './discord-auth.strategy';
import * as lifecycleUtil from '../../common/lifecycle.util';

/**
 * Unit tests for DiscordAuthStrategy — focused on onModuleInit callback
 * pattern and reloadConfig return type (TD-1 from ROK-981).
 */
describe('DiscordAuthStrategy', () => {
  let strategy: DiscordAuthStrategy;
  let mockSettingsService: { getDiscordOAuthConfig: jest.Mock };
  let mockAuthService: { validateDiscordUser: jest.Mock };

  beforeEach(() => {
    mockSettingsService = {
      getDiscordOAuthConfig: jest.fn(),
    };
    mockAuthService = {
      validateDiscordUser: jest.fn(),
    };

    strategy = new DiscordAuthStrategy(
      mockAuthService as any,
      mockSettingsService as any,
    );

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('reloadConfig', () => {
    it('returns void (not boolean) when config is found', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'id',
        clientSecret: 'secret',
        callbackUrl: 'http://localhost/callback',
      });

      const result = await strategy.reloadConfig();

      // TD-1: reloadConfig should return void, not boolean
      expect(result).toBeUndefined();
    });

    it('returns void (not boolean) when config is missing', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue(null);

      const result = await strategy.reloadConfig();

      expect(result).toBeUndefined();
    });

    it('returns void (not boolean) when config fetch throws', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockRejectedValue(
        new Error('DB down'),
      );

      const result = await strategy.reloadConfig();

      expect(result).toBeUndefined();
    });

    it('enables strategy when config is found', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'id',
        clientSecret: 'secret',
        callbackUrl: 'http://localhost/callback',
      });

      await strategy.reloadConfig();

      expect(strategy.isEnabled()).toBe(true);
    });

    it('disables strategy when config is missing', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue(null);

      await strategy.reloadConfig();

      expect(strategy.isEnabled()).toBe(false);
    });

    it('disables strategy when config fetch throws', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockRejectedValue(
        new Error('DB down'),
      );

      await strategy.reloadConfig();

      expect(strategy.isEnabled()).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('passes a direct method reference to bestEffortInit (not async wrapper)', async () => {
      const bestEffortSpy = jest
        .spyOn(lifecycleUtil, 'bestEffortInit')
        .mockResolvedValue(undefined);

      await strategy.onModuleInit();

      expect(bestEffortSpy).toHaveBeenCalledTimes(1);
      const [label, , callback] = bestEffortSpy.mock.calls[0];
      expect(label).toBe('DiscordAuthStrategy');

      // TD-1: callback should NOT be an async wrapper — it should be a
      // direct arrow returning the promise (consistent with other hooks)
      const fnString = callback.toString();
      expect(fnString).not.toContain('await');
    });
  });
});
