/**
 * ROK-1838: ENABLE_TELEMETRY / DISABLE_TELEMETRY truth table — ON by default,
 * `ENABLE_TELEMETRY='false'` opts out, `DISABLE_TELEMETRY='true'` still wins.
 */
import {
  TELEMETRY_DEFAULT_ENABLED,
  isTelemetryEnabled,
} from './telemetry-policy';

describe('isTelemetryEnabled (ROK-1838)', () => {
  it('defaults to on — per the 2026-10-17 ruling', () => {
    expect(TELEMETRY_DEFAULT_ENABLED).toBe(true);
  });

  it('unset → on', () => {
    expect(isTelemetryEnabled({})).toBe(true);
  });

  it("ENABLE_TELEMETRY='false' → off", () => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: 'false' })).toBe(false);
  });

  it("ENABLE_TELEMETRY='true' → on", () => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: 'true' })).toBe(true);
  });

  it("DISABLE_TELEMETRY='true' → off", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(false);
  });

  it("DISABLE_TELEMETRY='true' wins over ENABLE_TELEMETRY='true'", () => {
    expect(
      isTelemetryEnabled({
        ENABLE_TELEMETRY: 'true',
        DISABLE_TELEMETRY: 'true',
      }),
    ).toBe(false);
  });

  it("DISABLE_TELEMETRY='false' alone leaves it on", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'false' })).toBe(true);
  });

  it("DISABLE_TELEMETRY='false' does not undo ENABLE_TELEMETRY='false'", () => {
    expect(
      isTelemetryEnabled({
        ENABLE_TELEMETRY: 'false',
        DISABLE_TELEMETRY: 'false',
      }),
    ).toBe(false);
  });

  // Review MAJOR 1: the opt-out is EXACT. Anything that is not literally
  // 'false' keeps the default (ON) — a near-miss must never be guessed into
  // an opt-out the operator did not write.
  it.each([
    '1',
    '',
    'yes',
    'true',
    ' true ',
    'flase',
    'FALSE',
    'False',
    ' false',
    'false ',
    'false\n',
    '0',
    'no',
    'off',
    'OFF',
  ])("ENABLE_TELEMETRY='%s' → on (only exact 'false' opts out)", (value) => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: value })).toBe(true);
  });

  // Same for the back-compat kill switch: only exact 'true' turns it off.
  it.each(['TRUE', 'True', ' true', 'true ', '1', 'yes', 'on', 'On', '0', ''])(
    "DISABLE_TELEMETRY='%s' leaves it on (only exact 'true' wins)",
    (value) => {
      expect(
        isTelemetryEnabled({
          ENABLE_TELEMETRY: 'true',
          DISABLE_TELEMETRY: value,
        }),
      ).toBe(true);
    },
  );

  it('reads process.env when no env is passed', () => {
    const saved = process.env.ENABLE_TELEMETRY;
    const savedOff = process.env.DISABLE_TELEMETRY;
    process.env.ENABLE_TELEMETRY = 'false';
    delete process.env.DISABLE_TELEMETRY;
    try {
      expect(isTelemetryEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.ENABLE_TELEMETRY;
      else process.env.ENABLE_TELEMETRY = saved;
      if (savedOff !== undefined) process.env.DISABLE_TELEMETRY = savedOff;
    }
  });
});

type Policy = typeof import('./telemetry-policy');

describe('servedTelemetryEnabled (ROK-1779 Codex P2, ROK-1838 review MAJOR 2)', () => {
  afterEach(() => jest.resetModules());
  const PROD = { NODE_ENV: 'production' };

  it('reads the env live when instrument.ts never ran (tests, scripts)', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(
      policy.servedTelemetryEnabled({ ...PROD, ENABLE_TELEMETRY: 'false' }),
    ).toBe(false);
    expect(policy.servedTelemetryEnabled(PROD)).toBe(true);
  });

  it.each(['development', 'test', undefined])(
    'a non-production api (NODE_ENV=%s) never tells browsers to report',
    async (nodeEnv) => {
      jest.resetModules();
      const policy: Policy = await import('./telemetry-policy.js');
      expect(policy.servedTelemetryEnabled({ NODE_ENV: nodeEnv })).toBe(false);
      expect(policy.resolveBootTelemetry({ NODE_ENV: nodeEnv })).toBe(true);
      expect(policy.servedTelemetryEnabled(PROD)).toBe(false);
    },
  );

  it('serves the boot decision once one was recorded', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.resolveBootTelemetry(PROD)).toBe(true);
    expect(policy.servedTelemetryEnabled({})).toBe(true);
    expect(policy.servedTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(
      true,
    );
  });

  it('serves a boot-time opt-out even if the env later says nothing', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(
      policy.resolveBootTelemetry({ ...PROD, ENABLE_TELEMETRY: 'false' }),
    ).toBe(false);
    expect(policy.servedTelemetryEnabled(PROD)).toBe(false);
  });
});

describe('isProductionRuntime', () => {
  it('is true only for NODE_ENV=production', async () => {
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.isProductionRuntime({ NODE_ENV: 'production' })).toBe(true);
    expect(policy.isProductionRuntime({ NODE_ENV: 'development' })).toBe(false);
    expect(policy.isProductionRuntime({})).toBe(false);
  });
});
