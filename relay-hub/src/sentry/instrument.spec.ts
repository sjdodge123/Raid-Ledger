import { readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

const init = jest.fn();
jest.mock('@sentry/nestjs', () => ({ init }));

/** Re-imports instrument.ts with `env` as process.env. */
async function importWithEnv(env: Record<string, string>): Promise<void> {
  const saved = { ...process.env };
  delete process.env.SENTRY_DSN;
  delete process.env.DISABLE_TELEMETRY;
  Object.assign(process.env, env);
  await jest.isolateModulesAsync(async () => {
    await import('./instrument.js');
  });
  process.env = saved;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('relay-hub Sentry instrument', () => {
  beforeEach(() => init.mockClear());

  it.each([{}, { SENTRY_DSN: '' }, { SENTRY_DSN: '   ' }])(
    'never calls Sentry.init when SENTRY_DSN is unset or empty (%j)',
    async (env) => {
      await importWithEnv(env);
      expect(init).not.toHaveBeenCalled();
    },
  );

  it('never calls Sentry.init when DISABLE_TELEMETRY=true', async () => {
    await importWithEnv({
      SENTRY_DSN: 'https://k@example.test/1',
      DISABLE_TELEMETRY: 'true',
    });
    expect(init).not.toHaveBeenCalled();
  });

  it('inits once with the env DSN, environment relay-hub and APP_VERSION', async () => {
    await importWithEnv({
      SENTRY_DSN: 'https://k@example.test/1',
      APP_VERSION: '9.9.9',
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@example.test/1',
        environment: 'relay-hub',
        release: '9.9.9',
      }),
    );
  });

  it('omits release when APP_VERSION is unset', async () => {
    await importWithEnv({ SENTRY_DSN: 'https://k@example.test/1' });
    expect(init.mock.calls[0]?.[0]).not.toHaveProperty('release');
  });

  it('has no Sentry DSN literal anywhere in relay-hub/src', () => {
    const dsnLike = /https?:\/\/[0-9a-f]{16,}@[\w.-]*sentry\.io/;
    const offenders = sourceFiles(path.resolve(__dirname, '..')).filter((f) =>
      dsnLike.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
