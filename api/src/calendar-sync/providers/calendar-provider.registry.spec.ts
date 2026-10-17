/**
 * ROK-1592 (L12, L15): only `google` resolves; a `demo-fake:` row reaches
 * the fake only under the double gate with a fake registered — never Google.
 */
import type { CalendarAccountProvider } from './calendar-provider.interface';
import {
  CalendarProviderRegistry,
  DEMO_FAKE_SUBJECT_PREFIX,
  hasReadCapability,
  hasWriteCapability,
  type CalendarReadProvider,
  type CalendarWriteProvider,
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
const withWrite = (p: CalendarAccountProvider): CalendarWriteProvider => ({
  ...p,
  ensureRaidLedgerCalendar: jest.fn(),
  upsertEvent: jest.fn(),
  deleteEvent: jest.fn(),
  deleteRaidLedgerCalendar: jest.fn(),
});
const writeFake = withWrite(fake);
const FAKE_ROW = {
  provider: 'google',
  accountSubject: `${DEMO_FAKE_SUBJECT_PREFIX}user-7`,
};
const REAL_ROW = {
  provider: 'google',
  accountSubject: '109876543210987654321',
};

function registry(opts: {
  setting: boolean;
  withFake: boolean;
  google?: CalendarAccountProvider;
  fake?: CalendarAccountProvider;
}) {
  const settings: DemoModeSource = {
    getDemoMode: jest.fn().mockResolvedValue(opts.setting),
  };
  return new CalendarProviderRegistry(
    settings,
    opts.google ?? google,
    opts.withFake ? (opts.fake ?? fake) : null,
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

describe('CalendarProviderRegistry.getWriteProviderForConnection', () => {
  it('returns null for a provider without write capability (Google until G2)', async () => {
    const reg = registry({ setting: true, withFake: true });
    await expect(
      reg.getWriteProviderForConnection(REAL_ROW),
    ).resolves.toBeNull();
  });

  it('routes a real row to its adapter once it implements write', async () => {
    const writeGoogle = withWrite(google);
    const reg = registry({
      setting: false,
      withFake: false,
      google: writeGoogle,
    });
    await expect(reg.getWriteProviderForConnection(REAL_ROW)).resolves.toBe(
      writeGoogle,
    );
  });

  it('routes a demo-fake row to the write fake when env + setting + fake all hold', async () => {
    process.env.DEMO_MODE = 'true';
    const reg = registry({ setting: true, withFake: true, fake: writeFake });
    await expect(reg.getWriteProviderForConnection(FAKE_ROW)).resolves.toBe(
      writeFake,
    );
  });

  it.each([
    { env: 'false', setting: true, withFake: true, gate: 'env off' },
    { env: undefined, setting: true, withFake: true, gate: 'env unset' },
    { env: 'true', setting: false, withFake: true, gate: 'setting off' },
    { env: 'true', setting: true, withFake: false, gate: 'no fake' },
  ])(
    'resolves a demo-fake row to null ($gate), never a writing Google',
    async (c) => {
      if (c.env === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = c.env;
      const writeGoogle = withWrite(google);
      const reg = registry({ ...c, google: writeGoogle, fake: writeFake });
      const resolved = await reg.getWriteProviderForConnection(FAKE_ROW);
      expect(resolved).toBeNull();
      expect(resolved).not.toBe(writeGoogle);
    },
  );

  it('hasWriteCapability needs all four write methods', () => {
    const partial = {
      ...withWrite(google),
      deleteRaidLedgerCalendar: undefined,
    };
    expect(hasWriteCapability(withWrite(google))).toBe(true);
    expect(hasWriteCapability(partial as never)).toBe(false);
    expect(hasWriteCapability(google)).toBe(false);
    expect(hasWriteCapability(null)).toBe(false);
  });
});

describe('CalendarProviderRegistry.getReadProviderForConnection (ROK-1593)', () => {
  const withRead = (p: CalendarAccountProvider): CalendarReadProvider => ({
    ...p,
    listCalendars: jest.fn(),
    fetchBusy: jest.fn(),
  });
  const readFake = withRead(fake);

  it('null for an adapter without read; the adapter once it reads', async () => {
    const plain = registry({ setting: false, withFake: false });
    await expect(
      plain.getReadProviderForConnection(REAL_ROW),
    ).resolves.toBeNull();
    const readGoogle = withRead(google);
    const reg = registry({
      setting: false,
      withFake: false,
      google: readGoogle,
    });
    await expect(reg.getReadProviderForConnection(REAL_ROW)).resolves.toBe(
      readGoogle,
    );
  });

  it('routes a demo-fake row to the read fake only under the double gate', async () => {
    process.env.DEMO_MODE = 'true';
    const open = registry({ setting: true, withFake: true, fake: readFake });
    await expect(open.getReadProviderForConnection(FAKE_ROW)).resolves.toBe(
      readFake,
    );
  });

  it.each([
    { env: 'false', setting: true, withFake: true, gate: 'env off' },
    { env: 'true', setting: false, withFake: true, gate: 'setting off' },
    { env: 'true', setting: true, withFake: false, gate: 'no fake' },
  ])('a demo-fake row → null ($gate), never a reading Google', async (c) => {
    process.env.DEMO_MODE = c.env;
    const readGoogle = withRead(google);
    const reg = registry({ ...c, google: readGoogle, fake: readFake });
    const resolved = await reg.getReadProviderForConnection(FAKE_ROW);
    expect(resolved).toBeNull();
  });

  it('hasReadCapability needs both read methods', () => {
    expect(hasReadCapability(withRead(google))).toBe(true);
    const partial = { ...withRead(google), fetchBusy: undefined };
    expect(hasReadCapability(partial as never)).toBe(false);
    expect(hasReadCapability(google)).toBe(false);
    expect(hasReadCapability(null)).toBe(false);
  });
});
