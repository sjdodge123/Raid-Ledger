/**
 * ROK-1779: the api's beforeSend strips personal data, sendDefaultPii stays
 * off, and production reports by default (ROK-1838) unless
 * ENABLE_TELEMETRY='false' or DISABLE_TELEMETRY='true' (which still wins).
 * Split from instrument.spec.ts (at the 750-line test-file limit); the
 * loader mirrors its `jest.resetModules` + `jest.mock` harness.
 */
import { at, defined } from '../common/testing/narrow';

type InitMock = jest.MockedFunction<
  (options?: Record<string, unknown>) => void
>;
type Hook = (event: Record<string, unknown>) => Record<string, unknown> | null;

const KEYS = [
  'NODE_ENV',
  'DISABLE_TELEMETRY',
  'ENABLE_TELEMETRY',
  'SENTRY_ENVIRONMENT',
];

async function loadInstrument(
  env: Record<string, string | undefined>,
): Promise<InitMock> {
  const saved: Record<string, string | undefined> = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.resetModules();
  jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));
  // Never read a real .env: an opt-out in a dev checkout would skew the gate.
  jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }));
  try {
    await import('./instrument.js');
    const sentry = (await import('@sentry/nestjs')) as unknown as {
      init: InitMock;
    };
    return sentry.init;
  } finally {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function initConfig(mock: InitMock): Record<string, unknown> {
  return defined(at(mock.mock.calls, 0)[0], 'Sentry.init options');
}

function hook(mock: InitMock, name: string): Hook {
  const fn = initConfig(mock)[name];
  if (typeof fn !== 'function') throw new Error(`${name} is not a function`);
  return (event) => (fn as Hook)(event);
}

function piiEvent(): Record<string, unknown> {
  return {
    user: {
      id: 7,
      username: 'bob',
      email: 'bob@guild.example',
      ip_address: '203.0.113.9',
    },
    message: 'failed for bob@guild.example from 198.51.100.4',
    extra: { member: { username: 'bob', displayName: 'Bobby' } },
  };
}

function expectNoPii(result: Record<string, unknown> | null): void {
  if (result === null) throw new Error('the hook dropped the PII event');
  const event = result;
  const json = JSON.stringify(event);
  expect(json).not.toContain('guild.example');
  expect(json).not.toContain('203.0.113.9');
  expect(json).not.toContain('198.51.100.4');
  expect(json).not.toContain('Bobby');
  expect(event['user']).toEqual({ id: 7 });
}

describe('Sentry instrument — ROK-1779 PII + ROK-1838 runtime opt-out', () => {
  afterEach(() => jest.resetModules());

  describe('production', () => {
    let init: InitMock;
    beforeEach(async () => {
      init = await loadInstrument({
        NODE_ENV: 'production',
        ENABLE_TELEMETRY: 'true',
      });
    });

    it('beforeSend output carries no email, IP or username', () => {
      expectNoPii(hook(init, 'beforeSend')(piiEvent()));
    });

    it('beforeSendTransaction output carries no email, IP or username', () => {
      expectNoPii(hook(init, 'beforeSendTransaction')(piiEvent()));
    });

    it('pins sendDefaultPii off (dataCollection.userInfo === false)', () => {
      const dc = initConfig(init)['dataCollection'] as { userInfo?: unknown };
      expect(dc.userInfo).toBe(false);
    });
  });

  it('production with nothing set calls init (on by default, ROK-1838)', async () => {
    const init = await loadInstrument({ NODE_ENV: 'production' });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("ENABLE_TELEMETRY='false' in production skips init (ROK-1838 opt-out)", async () => {
    const init = await loadInstrument({
      NODE_ENV: 'production',
      ENABLE_TELEMETRY: 'false',
    });
    expect(init).not.toHaveBeenCalled();
  });

  it("ENABLE_TELEMETRY='true' in production calls init", async () => {
    const init = await loadInstrument({
      NODE_ENV: 'production',
      ENABLE_TELEMETRY: 'true',
    });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("DISABLE_TELEMETRY='false' alone in production calls init", async () => {
    const init = await loadInstrument({
      NODE_ENV: 'production',
      DISABLE_TELEMETRY: 'false',
    });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('DISABLE_TELEMETRY wins over ENABLE_TELEMETRY in production', async () => {
    const init = await loadInstrument({
      NODE_ENV: 'production',
      ENABLE_TELEMETRY: 'true',
      DISABLE_TELEMETRY: 'true',
    });
    expect(init).not.toHaveBeenCalled();
  });
});
