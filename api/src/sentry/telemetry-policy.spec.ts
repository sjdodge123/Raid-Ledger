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

  it.each(['1', '', 'yes', '0'])("ENABLE_TELEMETRY='%s' → on", (value) => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: value })).toBe(true);
  });

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

describe('servedTelemetryEnabled (ROK-1779 Codex P2)', () => {
  afterEach(() => jest.resetModules());

  it('reads the env live when instrument.ts never ran (tests, scripts)', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.servedTelemetryEnabled({ ENABLE_TELEMETRY: 'false' })).toBe(
      false,
    );
    expect(policy.servedTelemetryEnabled({})).toBe(true);
  });

  it('serves the boot decision once one was recorded', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.resolveBootTelemetry({})).toBe(true);
    expect(policy.servedTelemetryEnabled({})).toBe(true);
    expect(policy.servedTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(
      true,
    );
  });

  it('serves a boot-time opt-out even if the env later says nothing', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.resolveBootTelemetry({ ENABLE_TELEMETRY: 'false' })).toBe(
      false,
    );
    expect(policy.servedTelemetryEnabled({})).toBe(false);
  });
});
