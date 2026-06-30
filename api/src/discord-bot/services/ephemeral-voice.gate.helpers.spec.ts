/**
 * Gate-logic tests for ROK-1352 (ephemeral voice channels).
 *
 * `shouldCreateEphemeralChannel` is the pure resolution gate (no DB/Redis/env).
 * Resolution order:
 *   1. Global master toggle off → false (master gate)
 *   2. Force-ephemeral on        → true  (admin: always create)
 *   3. Per-event opt-in          → use it (null/false ⇒ no channel)
 *   4. else                      → false (default off)
 *
 * Series-wide enablement is NOT a tier — it propagates as the per-event column
 * across instances via the ROK-429 scope flow (PATCH /events/:id/series).
 */
import { shouldCreateEphemeralChannel } from './ephemeral-voice.gate.helpers';

interface GateInput {
  globalEnabled: boolean;
  forced: boolean;
  eventOverride: boolean | null;
}

function gate({ globalEnabled, forced, eventOverride }: GateInput) {
  return shouldCreateEphemeralChannel(globalEnabled, forced, eventOverride);
}

describe('shouldCreateEphemeralChannel — master gate (AC1)', () => {
  it('returns false when global is off, even if forced', () => {
    expect(
      gate({ globalEnabled: false, forced: true, eventOverride: true }),
    ).toBe(false);
  });

  it('returns false when global is off and per-event opted in', () => {
    expect(
      gate({ globalEnabled: false, forced: false, eventOverride: true }),
    ).toBe(false);
  });
});

describe('shouldCreateEphemeralChannel — force-ephemeral', () => {
  it('returns true for every event when forced (ignores per-event)', () => {
    expect(
      gate({ globalEnabled: true, forced: true, eventOverride: null }),
    ).toBe(true);
    expect(
      gate({ globalEnabled: true, forced: true, eventOverride: false }),
    ).toBe(true);
  });
});

describe('shouldCreateEphemeralChannel — per-event opt-in', () => {
  it('returns true when per-event opted in', () => {
    expect(
      gate({ globalEnabled: true, forced: false, eventOverride: true }),
    ).toBe(true);
  });

  it('returns false for explicit per-event false', () => {
    expect(
      gate({ globalEnabled: true, forced: false, eventOverride: false }),
    ).toBe(false);
  });

  it('returns false (default off) when no opt-in', () => {
    expect(
      gate({ globalEnabled: true, forced: false, eventOverride: null }),
    ).toBe(false);
  });
});
