/**
 * ROK-1592 (L12, L15): only `google` resolves; a `demo-fake:` row reaches
 * the fake only under the double gate with a fake registered — never Google.
 */
import type { CalendarAccountProvider } from './calendar-provider.interface';
import {
  CalendarProviderRegistry,
  DEMO_FAKE_SUBJECT_PREFIX,
  type DemoModeSource,
} from './calendar-provider.registry';

const stubProvider = (key: 'google'): CalendarAccountProvider => ({
  key,
  isConfigured: jest.fn(),
  buildAuthUrl: jest.fn(),
  connect: jest.fn(),
  refresh: jest.fn(),
  disconnect: jest.fn(),
});

const google = stubProvider('google');
const fake = stubProvider('google');
const FAKE_ROW = {
  provider: 'google',
  accountSubject: `${DEMO_FAKE_SUBJECT_PREFIX}user-7`,
};
const REAL_ROW = {
  provider: 'google',
  accountSubject: '109876543210987654321',
};

function registry(opts: { setting: boolean; withFake: boolean }) {
  const settings: DemoModeSource = {
    getDemoMode: jest.fn().mockResolvedValue(opts.setting),
  };
  return new CalendarProviderRegistry(
    settings,
    google,
    opts.withFake ? fake : null,
  );
}

const savedEnv = process.env.DEMO_MODE;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = savedEnv;
});

describe('CalendarProviderRegistry.getAccountProvider', () => {
  it('resolves google and nothing else', () => {
    const reg = registry({ setting: false, withFake: true });
    expect(reg.getAccountProvider('google')).toBe(google);
    expect(reg.getAccountProvider('microsoft')).toBeNull();
    expect(reg.getAccountProvider('apple')).toBeNull();
    expect(reg.getAccountProvider('fake')).toBeNull();
  });
});

describe('CalendarProviderRegistry.getAccountProviderForConnection', () => {
  it('routes a real row by its provider', async () => {
    process.env.DEMO_MODE = 'true';
    const reg = registry({ setting: true, withFake: true });
    await expect(reg.getAccountProviderForConnection(REAL_ROW)).resolves.toBe(
      google,
    );
    await expect(
      reg.getAccountProviderForConnection({
        ...REAL_ROW,
        provider: 'microsoft',
      }),
    ).resolves.toBeNull();
  });

  it('routes a demo-fake row to the fake when env + setting + fake all hold', async () => {
    process.env.DEMO_MODE = 'true';
    const reg = registry({ setting: true, withFake: true });
    await expect(reg.getAccountProviderForConnection(FAKE_ROW)).resolves.toBe(
      fake,
    );
  });

  it.each([
    { env: 'false', setting: true, withFake: true, gate: 'env off' },
    { env: undefined, setting: true, withFake: true, gate: 'env unset' },
    { env: 'true', setting: false, withFake: true, gate: 'setting off' },
    { env: 'true', setting: true, withFake: false, gate: 'no fake' },
  ])('resolves a demo-fake row to null ($gate), never Google', async (c) => {
    if (c.env === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = c.env;
    const reg = registry({ setting: c.setting, withFake: c.withFake });
    const resolved = await reg.getAccountProviderForConnection(FAKE_ROW);
    expect(resolved).toBeNull();
    expect(resolved).not.toBe(google);
  });
});
