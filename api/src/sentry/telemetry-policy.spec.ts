/** ROK-1779: ENABLE_TELEMETRY / DISABLE_TELEMETRY truth table (opt-in). */
import {
  TELEMETRY_DEFAULT_ENABLED,
  isTelemetryEnabled,
} from './telemetry-policy';

describe('isTelemetryEnabled (ROK-1779)', () => {
  it('defaults to off — opt-in per the 2026-10-15 ruling', () => {
    expect(TELEMETRY_DEFAULT_ENABLED).toBe(false);
  });

  it('unset → off', () => {
    expect(isTelemetryEnabled({})).toBe(false);
  });

  it("ENABLE_TELEMETRY='true' → on", () => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: 'true' })).toBe(true);
  });

  it("DISABLE_TELEMETRY='true' → off", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(false);
  });

  it('DISABLE_TELEMETRY wins when both are set', () => {
    expect(
      isTelemetryEnabled({
        ENABLE_TELEMETRY: 'true',
        DISABLE_TELEMETRY: 'true',
      }),
    ).toBe(false);
  });

  it("DISABLE_TELEMETRY='false' alone does not opt in", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'false' })).toBe(false);
  });

  it.each(['1', '', 'TRUE', 'yes'])("ENABLE_TELEMETRY='%s' → off", (value) => {
    expect(isTelemetryEnabled({ ENABLE_TELEMETRY: value })).toBe(false);
  });

  it('reads process.env when no env is passed', () => {
    const saved = process.env.ENABLE_TELEMETRY;
    const savedOff = process.env.DISABLE_TELEMETRY;
    process.env.ENABLE_TELEMETRY = 'true';
    delete process.env.DISABLE_TELEMETRY;
    try {
      expect(isTelemetryEnabled()).toBe(true);
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
    expect(policy.servedTelemetryEnabled({ ENABLE_TELEMETRY: 'true' })).toBe(
      true,
    );
    expect(policy.servedTelemetryEnabled({})).toBe(false);
  });

  it('serves the boot decision once one was recorded', async () => {
    jest.resetModules();
    const policy: Policy = await import('./telemetry-policy.js');
    expect(policy.resolveBootTelemetry({ ENABLE_TELEMETRY: 'true' })).toBe(
      true,
    );
    expect(policy.servedTelemetryEnabled({})).toBe(true);
    expect(policy.servedTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(
      true,
    );
  });
});
