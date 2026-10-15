/** ROK-1779: DISABLE_TELEMETRY truth table for the runtime opt-out. */
import {
  TELEMETRY_DEFAULT_ENABLED,
  isTelemetryEnabled,
} from './telemetry-policy';

describe('isTelemetryEnabled (ROK-1779)', () => {
  it('keeps the opt-out default until the operator rules otherwise', () => {
    expect(TELEMETRY_DEFAULT_ENABLED).toBe(true);
  });

  it('unset → the default', () => {
    expect(isTelemetryEnabled({})).toBe(TELEMETRY_DEFAULT_ENABLED);
  });

  it("'true' → off", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'true' })).toBe(false);
  });

  it("'false' set explicitly → on", () => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: 'false' })).toBe(true);
  });

  it.each(['1', '', 'TRUE', 'yes'])("'%s' → the default", (value) => {
    expect(isTelemetryEnabled({ DISABLE_TELEMETRY: value })).toBe(
      TELEMETRY_DEFAULT_ENABLED,
    );
  });

  it('reads process.env when no env is passed', () => {
    const saved = process.env.DISABLE_TELEMETRY;
    process.env.DISABLE_TELEMETRY = 'true';
    try {
      expect(isTelemetryEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.DISABLE_TELEMETRY;
      else process.env.DISABLE_TELEMETRY = saved;
    }
  });
});
