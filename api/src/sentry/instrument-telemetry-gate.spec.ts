/**
 * ROK-1779 Codex P2: the api's Sentry boot gate and GET /system/status must
 * read the same resolved telemetry decision. instrument.ts runs before
 * ConfigModule loads .env, so it loads that file itself and records the
 * decision that /system/status then serves.
 */
type Policy = typeof import('./telemetry-policy');

const KEYS = ['NODE_ENV', 'ENABLE_TELEMETRY', 'DISABLE_TELEMETRY'] as const;

interface Booted {
  sentryInit: jest.Mock;
  dotenvConfig: jest.Mock;
  policy: Policy;
}

/** Boot instrument.ts with `env` set and `envFile` standing in for .env. */
async function boot(
  env: Partial<Record<(typeof KEYS)[number], string>>,
  envFile: Record<string, string> = {},
): Promise<Booted> {
  const saved = KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.resetModules();
  jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));
  // Fills only unset keys, like dotenv and ConfigModule. Never reads a file.
  jest.mock('dotenv', () => ({
    config: jest.fn(() => {
      for (const [key, value] of Object.entries(envFile)) {
        process.env[key] ??= value;
      }
      return { parsed: envFile };
    }),
  }));
  try {
    await import('./instrument.js');
    const sentry = (await import('@sentry/nestjs')) as unknown as {
      init: jest.Mock;
    };
    const dotenv = (await import('dotenv')) as unknown as {
      config: jest.Mock;
    };
    const policy: Policy = await import('./telemetry-policy.js');
    return { sentryInit: sentry.init, dotenvConfig: dotenv.config, policy };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('ROK-1779: boot gate and /system/status agree', () => {
  afterEach(() => jest.resetModules());

  it('loads the .env ConfigModule uses before evaluating the gate', async () => {
    const { sentryInit, dotenvConfig, policy } = await boot(
      { NODE_ENV: 'production' },
      { ENABLE_TELEMETRY: 'true' },
    );
    expect(dotenvConfig).toHaveBeenCalledWith({
      path: policy.API_ENV_FILE,
      quiet: true,
    });
    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it('status says ON when the gate turned Sentry on from .env, whatever the env says later', async () => {
    const { sentryInit, policy } = await boot(
      { NODE_ENV: 'production' },
      { ENABLE_TELEMETRY: 'true' },
    );
    expect(sentryInit).toHaveBeenCalledTimes(1);
    expect(policy.servedTelemetryEnabled({})).toBe(true);
  });

  it('status says OFF when the gate left Sentry off, even if ENABLE_TELEMETRY appears later', async () => {
    const { sentryInit, policy } = await boot({ NODE_ENV: 'production' });
    expect(sentryInit).not.toHaveBeenCalled();
    expect(policy.servedTelemetryEnabled({ ENABLE_TELEMETRY: 'true' })).toBe(
      false,
    );
  });

  it('a real .env value never overrides one set in the environment', async () => {
    const { sentryInit, policy } = await boot(
      { NODE_ENV: 'production', DISABLE_TELEMETRY: 'true' },
      { ENABLE_TELEMETRY: 'true', DISABLE_TELEMETRY: 'false' },
    );
    expect(sentryInit).not.toHaveBeenCalled();
    expect(policy.servedTelemetryEnabled({})).toBe(false);
  });
});
