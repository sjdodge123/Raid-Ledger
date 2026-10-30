/**
 * ROK-1697: the env-configured DiscordStrategy defaults its callback to the
 * platform public URL, with DISCORD_CALLBACK_URL still winning.
 */
import { DiscordStrategy } from './discord.strategy';
import type { AuthService } from './auth.service';
import { PLATFORM_PUBLIC_URL_VARS } from '../settings/client-url.helpers';

const NAMES = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_CALLBACK_URL',
  ...PLATFORM_PUBLIC_URL_VARS,
];

/** The callback URL passport-oauth2 stored on the constructed strategy. */
function callbackOf(strategy: DiscordStrategy): unknown {
  return Reflect.get(strategy, '_callbackURL');
}

describe('DiscordStrategy callback default (ROK-1697)', () => {
  const original = NAMES.map((name) => [name, process.env[name]] as const);
  const authService = {} as AuthService;

  beforeEach(() => {
    NAMES.forEach((name) => delete process.env[name]);
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('defaults to <public url>/api/auth/discord/callback', () => {
    process.env.FLY_APP_NAME = 'raid-ledger';
    expect(callbackOf(new DiscordStrategy(authService))).toBe(
      'https://raid-ledger.fly.dev/api/auth/discord/callback',
    );
  });

  it('keeps the localhost default when no public URL resolves', () => {
    expect(callbackOf(new DiscordStrategy(authService))).toBe(
      'http://localhost/api/auth/discord/callback',
    );
  });

  it('lets DISCORD_CALLBACK_URL outrank the public URL', () => {
    process.env.PUBLIC_URL = 'https://public.example';
    process.env.DISCORD_CALLBACK_URL = 'https://env.example/cb';
    expect(callbackOf(new DiscordStrategy(authService))).toBe(
      'https://env.example/cb',
    );
  });
});
