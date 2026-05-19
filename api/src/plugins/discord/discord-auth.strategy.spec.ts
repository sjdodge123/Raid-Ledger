// Mock the passport singleton so we can spy on `passport.use(...)` calls
// made by the NestJS PassportStrategy mixin AND by any Fix-2
// re-registration in reloadConfig. Keep the surface minimal — just enough
// for the mixin's `passportInstance.use(name, this)` line not to throw.
jest.mock('passport', () => ({
  use: jest.fn(),
  unuse: jest.fn(),
}));

import { Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport') as {
  use: jest.Mock;
  unuse: jest.Mock;
};
import { Strategy as DiscordPassportStrategy } from 'passport-discord';
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
    passport.use.mockClear();
    passport.unuse.mockClear();

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

    // AC8 (regression assertion) — locks in that invoking the callback
    // passed to bestEffortInit actually calls reloadConfig. Today this
    // passes; the goal is to detect any future refactor that decouples
    // onModuleInit from reloadConfig and breaks the boot path.
    it('AC8 — invoking the bestEffortInit callback calls reloadConfig (boot path unchanged)', async () => {
      const bestEffortSpy = jest
        .spyOn(lifecycleUtil, 'bestEffortInit')
        .mockResolvedValue(undefined);
      const reloadSpy = jest
        .spyOn(strategy, 'reloadConfig')
        .mockResolvedValue(undefined);

      await strategy.onModuleInit();

      expect(bestEffortSpy).toHaveBeenCalledTimes(1);
      const callback = bestEffortSpy.mock.calls[0][2];
      await callback();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // ROK-1325 — hot-reload propagation tests (Fix 2 + Fix 3)
  // -------------------------------------------------------------------------
  describe('reloadConfig — re-registers strategy on passport (Fix 2, AC4)', () => {
    it('AC4 — calls passport.use("discord", <fresh Strategy>) reflecting new callbackUrl', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'new-client-id',
        clientSecret: 'new-client-secret',
        callbackUrl: 'https://slot-1.gamernight.net/api/auth/discord/callback',
      });

      // Construction (via NestJS PassportStrategy mixin) already invoked
      // passport.use once with the placeholder. Clear so we only see the
      // re-registration triggered by reloadConfig.
      passport.use.mockClear();

      await strategy.reloadConfig();

      // Find any reload-driven registration under the 'discord' name.
      const reloadCalls = passport.use.mock.calls.filter(
        (args) => args[0] === 'discord',
      );
      expect(reloadCalls.length).toBeGreaterThanOrEqual(1);

      const [, registeredStrategy] = reloadCalls[reloadCalls.length - 1] as [
        string,
        unknown,
      ];
      expect(registeredStrategy).toBeDefined();

      // The freshly-registered strategy should be a bare passport-discord
      // Strategy whose internal callbackURL reflects the new config — not
      // a placeholder, not the original constructed instance.
      const internal = registeredStrategy as {
        _callbackURL?: string;
        _oauth2?: { _clientId?: string; _clientSecret?: string };
      };
      expect(internal._callbackURL).toBe(
        'https://slot-1.gamernight.net/api/auth/discord/callback',
      );
      expect(internal._oauth2?._clientId).toBe('new-client-id');
      expect(internal._oauth2?._clientSecret).toBe('new-client-secret');
    });
  });

  describe('authenticate — per-request callbackURL injection (Fix 3, AC5/AC6)', () => {
    it('AC5 — injects latestConfig.callbackUrl into super.authenticate options even when _callbackURL is stale', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'cid',
        clientSecret: 'csec',
        callbackUrl: 'https://new.example/cb',
      });
      await strategy.reloadConfig();

      // Deliberately desync the legacy internal state to prove the
      // injection path is what's load-bearing — NOT _callbackURL.
      (strategy as unknown as { _callbackURL: string })._callbackURL =
        'http://stale.localhost:3000/wrong';

      // Spy on the inherited authenticate (OAuth2Strategy.prototype.authenticate
      // is reached via Strategy.prototype → OAuth2Strategy.prototype).
      const superAuth = jest
        .spyOn(
          Object.getPrototypeOf(DiscordPassportStrategy.prototype) as object,
          'authenticate',
        )
        .mockImplementation(() => undefined);

      const req = { query: {}, headers: {}, url: '/auth/discord' } as never;
      strategy.authenticate(req, { state: 'abc' });

      expect(superAuth).toHaveBeenCalledTimes(1);
      const [, forwardedOptions] = superAuth.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(forwardedOptions).toBeDefined();
      expect(forwardedOptions.callbackURL).toBe('https://new.example/cb');
      // Caller-provided options preserved.
      expect(forwardedOptions.state).toBe('abc');
    });

    it('AC6 — when strategy is NOT configured, does NOT inject callbackURL and forwards original options unchanged', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue(null);
      await strategy.reloadConfig();
      expect(strategy.isEnabled()).toBe(false);

      const superAuth = jest
        .spyOn(
          Object.getPrototypeOf(DiscordPassportStrategy.prototype) as object,
          'authenticate',
        )
        .mockImplementation(() => undefined);

      const req = { query: {}, headers: {}, url: '/auth/discord' } as never;
      const originalOptions = { state: 'xyz' };
      strategy.authenticate(req, originalOptions);

      expect(superAuth).toHaveBeenCalledTimes(1);
      const [, forwardedOptions] = superAuth.mock.calls[0] as [
        unknown,
        Record<string, unknown> | undefined,
      ];
      // No callbackURL injection in the disabled passthrough path.
      expect(forwardedOptions?.callbackURL).toBeUndefined();
      // Original options are forwarded (either the same reference or
      // structurally equivalent — both shapes are acceptable, the assertion
      // that matters is "no callbackURL key added").
      expect(forwardedOptions?.state).toBe('xyz');
    });
  });

  describe('verify callback shared between code paths (AC7)', () => {
    it('AC7 — the freshly-registered bare Strategy (Fix 2) ultimately delegates to authService.validateDiscordUser', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'cid',
        clientSecret: 'csec',
        callbackUrl: 'https://new.example/cb',
      });
      mockAuthService.validateDiscordUser.mockResolvedValue({
        id: 42,
        username: 'tester',
        role: 'user',
      });

      passport.use.mockClear();
      await strategy.reloadConfig();

      const reloadCalls = passport.use.mock.calls.filter(
        (args) => args[0] === 'discord',
      );
      expect(reloadCalls.length).toBeGreaterThanOrEqual(1);

      const registeredStrategy = reloadCalls[
        reloadCalls.length - 1
      ][1] as object;

      // The bare Strategy stores its verify callback as `_verify` (inherited
      // from passport-oauth2). Invoke it with a synthetic profile and
      // assert it routes to authService.validateDiscordUser.
      const internal = registeredStrategy as {
        _verify?: (
          accessToken: string,
          refreshToken: string,
          profile: { id: string; username: string; avatar?: string | null },
          done: (err: unknown, user?: unknown) => void,
        ) => void | Promise<void>;
      };
      expect(typeof internal._verify).toBe('function');

      const profile = {
        id: 'discord-id-123',
        username: 'tester',
        avatar: 'abc.png',
      };
      const done = jest.fn();
      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        internal._verify!('access', 'refresh', profile, done);
      });

      expect(mockAuthService.validateDiscordUser).toHaveBeenCalledWith(
        'discord-id-123',
        'tester',
        'abc.png',
      );
      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        id: 42,
        username: 'tester',
      }));
    });

    it('AC7 — the freshly-registered bare Strategy rejects with "Failed to validate Discord user" when authService returns null', async () => {
      mockSettingsService.getDiscordOAuthConfig.mockResolvedValue({
        clientId: 'cid',
        clientSecret: 'csec',
        callbackUrl: 'https://new.example/cb',
      });
      mockAuthService.validateDiscordUser.mockResolvedValue(null);

      passport.use.mockClear();
      await strategy.reloadConfig();

      const reloadCalls = passport.use.mock.calls.filter(
        (args) => args[0] === 'discord',
      );
      const registeredStrategy = reloadCalls[
        reloadCalls.length - 1
      ][1] as object;
      const internal = registeredStrategy as {
        _verify?: (
          accessToken: string,
          refreshToken: string,
          profile: { id: string; username: string; avatar?: string | null },
          done: (err: unknown, user?: unknown) => void,
        ) => void | Promise<void>;
      };

      const profile = { id: 'discord-id-999', username: 'ghost', avatar: null };
      const done = jest.fn();
      await new Promise<void>((resolve) => {
        done.mockImplementation(() => resolve());
        internal._verify!('access', 'refresh', profile, done);
      });

      const [err] = done.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Failed to validate Discord user');
    });
  });
});
