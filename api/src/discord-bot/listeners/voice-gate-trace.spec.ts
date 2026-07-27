/**
 * ROK-1417 (plan B4 Tier 1+2) — TDD failing tests for the per-join gate trace.
 *
 * Target module `./voice-gate-trace` does NOT exist yet — this suite is
 * fails-by-construction (module absent) until the dev creates it. It pins the
 * D5 contract verbatim:
 *   - `traceGate(logger, outcome, ctx)` logs ONE string argument at
 *     `logger.log` (never debug), `outcome=` FIRST, fixed key order:
 *     `[voice-gate] outcome=<t> ch=<id> binding=<id> purpose=<p> game=<id|null>
 *      members=N min=N counted=N confirmed=N`
 *   - `game=null` printed LITERALLY (the null is the signal); undefined optional
 *     keys omitted.
 *   - throttle: module Map keyed `${channelId}:${bindingId}:${outcome}`, 60s
 *     window, `repeat=N` on the first emit after the window closes; different
 *     bindingIds on the SAME channel do NOT share a bucket.
 *   - `warnInertOnce(logger, ctx)` → `logger.warn` + stable-message
 *     `Sentry.captureMessage('Inert Quick Play binding', …)`, deduped 15 min.
 *   - `__resetTraceState()` clears both throttle Maps (test-only).
 *
 * GateCtx field → output-key contract: channelId→ch, bindingId→binding,
 * purpose→purpose, gameId→game, members→members, minPlayers→min,
 * counted→counted, confirmed→confirmed.
 *
 * Time is driven with jest.setSystemTime (traceGate reads Date.now()); no sleep.
 */
import type { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  traceGate,
  warnInertOnce,
  __resetTraceState,
  type GateCtx,
} from './voice-gate-trace';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const BASE = new Date('2026-07-27T05:00:00.000Z').getTime();

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn() };
}

/** The `[voice-gate] …` lines the logger.log spy captured (single string arg). */
function gateLines(logger: ReturnType<typeof makeLogger>): string[] {
  return logger.log.mock.calls
    .map((c) => c[0])
    .filter((a): a is string => typeof a === 'string' && a.startsWith('[voice-gate]'));
}

const FULL_CTX: GateCtx = {
  channelId: 'ch1',
  bindingId: 'bind-1',
  purpose: 'game-voice-monitor',
  gameId: null,
  members: 3,
  minPlayers: 2,
  counted: 0,
  confirmed: 0,
};

describe('voice-gate-trace (ROK-1417 B4 Tier 1+2)', () => {
  let logger: ReturnType<typeof makeLogger>;
  const asLogger = () => logger as unknown as Logger;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE);
    __resetTraceState();
    logger = makeLogger();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('traceGate — message shape', () => {
    it('emits exactly ONE string argument at logger.log (not printf-style multi-arg)', () => {
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(logger.log.mock.calls[0]).toHaveLength(1);
      expect(typeof logger.log.mock.calls[0][0]).toBe('string');
    });

    it('puts outcome= FIRST, right after the [voice-gate] tag', () => {
      traceGate(asLogger(), 'spawned-immediate', FULL_CTX);
      expect(gateLines(logger)[0]).toMatch(/^\[voice-gate\] outcome=spawned-immediate /);
    });

    it('prints the full fixed-key line in order when every field is present', () => {
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      expect(gateLines(logger)[0]).toBe(
        '[voice-gate] outcome=below-threshold-inert ch=ch1 binding=bind-1 ' +
          'purpose=game-voice-monitor game=null members=3 min=2 counted=0 confirmed=0',
      );
    });

    it('prints game=null LITERALLY for a null-game binding (the null is the signal)', () => {
      traceGate(asLogger(), 'below-threshold-inert', { ...FULL_CTX, gameId: null });
      expect(gateLines(logger)[0]).toContain(' game=null ');
    });

    it('prints game=<id> for a numeric game', () => {
      traceGate(asLogger(), 'spawn-scheduled', { ...FULL_CTX, gameId: 42 });
      expect(gateLines(logger)[0]).toContain(' game=42 ');
    });

    it('OMITS undefined optional keys (members/min/counted/confirmed) but keeps game=null', () => {
      traceGate(asLogger(), 'below-threshold-inert', {
        channelId: 'ch2',
        bindingId: 'bind-2',
        purpose: 'game-voice-monitor',
        gameId: null,
      });
      const line = gateLines(logger)[0];
      expect(line).toBe(
        '[voice-gate] outcome=below-threshold-inert ch=ch2 binding=bind-2 ' +
          'purpose=game-voice-monitor game=null',
      );
      expect(line).not.toContain('members=');
      expect(line).not.toContain('min=');
      expect(line).not.toContain('counted=');
      expect(line).not.toContain('confirmed=');
    });
  });

  describe('traceGate — 60s throttle', () => {
    it('collapses 3 identical emits within 60s into ONE line (no repeat= on the first)', () => {
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      jest.setSystemTime(BASE + 20_000);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      jest.setSystemTime(BASE + 40_000);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);

      const lines = gateLines(logger);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('repeat=');
    });

    it('the first emit AFTER the window closes carries repeat=3 (count of the closed window)', () => {
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      jest.setSystemTime(BASE + 20_000);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      jest.setSystemTime(BASE + 40_000);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);

      jest.setSystemTime(BASE + 70_000);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);

      const lines = gateLines(logger);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('repeat=3');
    });

    it('different bindingIds on the SAME channel do NOT share a throttle bucket', () => {
      traceGate(asLogger(), 'below-threshold', {
        channelId: 'chX',
        bindingId: 'bind-A',
        purpose: 'game-voice-monitor',
        gameId: 1,
      });
      traceGate(asLogger(), 'below-threshold', {
        channelId: 'chX',
        bindingId: 'bind-B',
        purpose: 'game-voice-monitor',
        gameId: 2,
      });
      expect(gateLines(logger)).toHaveLength(2);
    });

    it('different outcomes for the same channel+binding do NOT share a bucket', () => {
      traceGate(asLogger(), 'below-threshold', FULL_CTX);
      traceGate(asLogger(), 'spawn-scheduled', FULL_CTX);
      expect(gateLines(logger)).toHaveLength(2);
    });

    it('__resetTraceState clears the throttle so an identical emit fires again', () => {
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX); // throttled
      expect(gateLines(logger)).toHaveLength(1);

      __resetTraceState();
      traceGate(asLogger(), 'below-threshold-inert', FULL_CTX);
      expect(gateLines(logger)).toHaveLength(2);
    });
  });

  describe('warnInertOnce — 15-min dedupe + Sentry', () => {
    it('warns at logger.warn (NOT logger.log) with a single string argument', () => {
      warnInertOnce(asLogger(), FULL_CTX);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]).toHaveLength(1);
      expect(typeof logger.warn.mock.calls[0][0]).toBe('string');
    });

    it('captures the stable Sentry message with the binding-health tag + channelId', () => {
      warnInertOnce(asLogger(), FULL_CTX);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Inert Quick Play binding',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({
            context: 'binding-health',
            channelId: FULL_CTX.channelId,
          }),
        }),
      );
    });

    it('dedupes a repeat within 15 minutes, then fires again after the window', () => {
      warnInertOnce(asLogger(), FULL_CTX);
      jest.setSystemTime(BASE + 10 * 60_000);
      warnInertOnce(asLogger(), FULL_CTX); // still inside 15-min window → deduped
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);

      jest.setSystemTime(BASE + 16 * 60_000);
      warnInertOnce(asLogger(), FULL_CTX); // window elapsed → fires again
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    });

    it('keeps a separate 15-min bucket per bindingId', () => {
      warnInertOnce(asLogger(), { ...FULL_CTX, bindingId: 'bind-A' });
      warnInertOnce(asLogger(), { ...FULL_CTX, bindingId: 'bind-B' });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });
});
