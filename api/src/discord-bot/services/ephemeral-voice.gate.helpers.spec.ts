/**
 * Failing-first gate-logic tests for ROK-1352 (ephemeral voice channels).
 *
 * `shouldCreateEphemeralChannel` is the pure resolution gate (no DB/Redis/env)
 * the dev will add to `api/src/discord-bot/services/ephemeral-voice.gate.helpers.ts`.
 * Resolution order (spec AC2):
 *   1. Global master toggle off              → false   (master gate)
 *   2. Per-event override non-null           → use it  (override wins)
 *   3. else per-series flag true             → true
 *   4. else                                  → false   (default off)
 *
 * The gate takes the already-resolved inputs as arguments so it is unit-testable
 * with no infrastructure. It MUST fail today: the helper file does not exist yet,
 * so the import throws at module load.
 */
import { shouldCreateEphemeralChannel } from './ephemeral-voice.gate.helpers';

/** Inputs to the gate: master toggle, per-event override (null = inherit), per-series flag. */
interface GateInput {
  globalEnabled: boolean;
  eventOverride: boolean | null;
  seriesEnabled: boolean;
}

function gate({ globalEnabled, eventOverride, seriesEnabled }: GateInput) {
  return shouldCreateEphemeralChannel(globalEnabled, eventOverride, seriesEnabled);
}

describe('shouldCreateEphemeralChannel — master gate (ROK-1352 AC1)', () => {
  it('returns false when global is off, regardless of per-event override', () => {
    expect(
      gate({ globalEnabled: false, eventOverride: true, seriesEnabled: true }),
    ).toBe(false);
  });

  it('returns false when global is off and series is on', () => {
    expect(
      gate({ globalEnabled: false, eventOverride: null, seriesEnabled: true }),
    ).toBe(false);
  });
});

describe('shouldCreateEphemeralChannel — per-event override wins (ROK-1352 AC2)', () => {
  it('per-event true overrides series=false', () => {
    expect(
      gate({ globalEnabled: true, eventOverride: true, seriesEnabled: false }),
    ).toBe(true);
  });

  it('per-event false overrides series=true (single-occurrence opt-out)', () => {
    expect(
      gate({ globalEnabled: true, eventOverride: false, seriesEnabled: true }),
    ).toBe(false);
  });
});

describe('shouldCreateEphemeralChannel — per-series fallback (ROK-1352 AC2)', () => {
  it('returns true when no override and series flag is on', () => {
    expect(
      gate({ globalEnabled: true, eventOverride: null, seriesEnabled: true }),
    ).toBe(true);
  });

  it('returns false when no override and series flag is off', () => {
    expect(
      gate({ globalEnabled: true, eventOverride: null, seriesEnabled: false }),
    ).toBe(false);
  });
});

describe('shouldCreateEphemeralChannel — default off (ROK-1352 AC2)', () => {
  it('returns false with global on but no opt-in anywhere', () => {
    expect(
      gate({ globalEnabled: true, eventOverride: null, seriesEnabled: false }),
    ).toBe(false);
  });
});
