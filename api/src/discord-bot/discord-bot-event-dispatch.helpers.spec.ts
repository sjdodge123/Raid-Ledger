/**
 * Unit tests for isolated lifecycle-event fan-out (ROK-1425 follow-up).
 *
 * These run against a REAL EventEmitter2, not a mock — the whole defect lives
 * in EventEmitter2's own loop semantics, so a stubbed emitter would prove
 * nothing. Verified against the pre-fix implementation: with subscribers
 * A,B(throws),C,D a single `await emitAsync(...)` in one try/catch runs only
 * A,B and silently drops C,D.
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { emitIsolated } from './discord-bot-event-dispatch.helpers';

const EVENT = 'discord-bot.connected';

/**
 * Register a promise-returning subscriber.
 *
 * Registering an inline `async function` directly on the emitter trips
 * `no-misused-promises` at each call site. Routing through one typed helper
 * states the intent once: real NestJS `@OnEvent` subscribers may be async, and
 * async subscribers are precisely what this suite exercises.
 */
function onAsync(
  emitter: EventEmitter2,
  event: string,
  fn: () => Promise<unknown>,
): void {
  // The listener MUST return its promise so emitIsolated can await it — that is
  // the exact behavior under test. Wrapping as `() => { void fn(); }` would
  // silence the rule but defeat the suite: rejections become unobservable and
  // the await-to-completion case would pass vacuously. A type assertion instead
  // trips no-unnecessary-type-assertion, so the two rules genuinely conflict.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  emitter.on(event, fn);
}

function makeLogger(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

describe('emitIsolated', () => {
  let emitter: EventEmitter2;
  let logger: Logger;
  let ran: string[];

  beforeEach(() => {
    emitter = new EventEmitter2({ maxListeners: 50 });
    logger = makeLogger();
    ran = [];
  });

  /** Named so the failure log can identify it (describeListener uses fn.name). */
  function ok(tag: string) {
    return function okSubscriber() {
      ran.push(tag);
    };
  }

  describe('Regression: ROK-1425 — one bad subscriber must not strand the rest', () => {
    it('runs every later subscriber when an earlier one throws SYNCHRONOUSLY', async () => {
      emitter.on(EVENT, ok('A'));
      emitter.on(EVENT, function throwingSubscriber() {
        ran.push('B');
        throw new Error('boom');
      });
      emitter.on(EVENT, ok('C'));
      emitter.on(EVENT, ok('D'));

      const result = await emitIsolated(emitter, EVENT, logger);

      // Pre-fix this was ['A','B'] — C and D never attached their handlers.
      expect(ran).toEqual(['A', 'B', 'C', 'D']);
      expect(result).toEqual({ total: 4, failed: 1, degraded: false });
    });

    it('runs every later subscriber when an earlier one REJECTS', async () => {
      emitter.on(EVENT, ok('A'));
      onAsync(emitter, EVENT, function rejectingSubscriber() {
        ran.push('B');
        return Promise.reject(new Error('async boom'));
      });
      emitter.on(EVENT, ok('C'));

      const result = await emitIsolated(emitter, EVENT, logger);

      expect(ran).toEqual(['A', 'B', 'C']);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(3);
    });

    it('survives MULTIPLE failing subscribers and still runs all the good ones', async () => {
      emitter.on(EVENT, function bad1() {
        throw new Error('one');
      });
      emitter.on(EVENT, ok('A'));
      emitter.on(EVENT, function bad2() {
        throw new Error('two');
      });
      emitter.on(EVENT, ok('B'));
      emitter.on(EVENT, function bad3() {
        throw new Error('three');
      });

      const result = await emitIsolated(emitter, EVENT, logger);

      expect(ran).toEqual(['A', 'B']);
      expect(result).toEqual({ total: 5, failed: 3, degraded: false });
    });

    it('awaits async subscribers to completion, not just to first tick', async () => {
      onAsync(emitter, EVENT, async function slowSubscriber() {
        await new Promise((r) => setImmediate(r));
        ran.push('slow');
      });
      emitter.on(EVENT, ok('fast'));

      await emitIsolated(emitter, EVENT, logger);

      expect(ran).toContain('slow');
      expect(ran).toHaveLength(2);
    });
  });

  describe('diagnostics', () => {
    it('logs each failure with the subscriber identity', async () => {
      emitter.on(EVENT, ok('A'));
      emitter.on(EVENT, function throwingSubscriber() {
        throw new Error('boom');
      });

      await emitIsolated(emitter, EVENT, logger);

      const messages = (logger.error as jest.Mock).mock.calls.map((c) =>
        String(c[0]),
      );
      expect(
        messages.some(
          (m) => m.includes('throwingSubscriber') && m.includes('boom'),
        ),
      ).toBe(true);
    });

    it('states explicitly that the remaining subscribers still ran', async () => {
      emitter.on(EVENT, function bad() {
        throw new Error('boom');
      });
      emitter.on(EVENT, ok('A'));
      emitter.on(EVENT, ok('B'));

      await emitIsolated(emitter, EVENT, logger);

      const messages = (logger.error as jest.Mock).mock.calls.map((c) =>
        String(c[0]),
      );
      // Without this the old single line read as "the chain died".
      expect(messages.some((m) => m.includes('still ran'))).toBe(true);
    });

    it('warns when nothing is subscribed', async () => {
      const result = await emitIsolated(emitter, EVENT, logger);

      expect(result).toEqual({ total: 0, failed: 0, degraded: false });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no subscribers'),
      );
    });

    it('does not log an error when every subscriber succeeds', async () => {
      emitter.on(EVENT, ok('A'));
      emitter.on(EVENT, ok('B'));

      const result = await emitIsolated(emitter, EVENT, logger);

      expect(result.failed).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('fallback for a non-enumerable emitter', () => {
    it('uses emitAsync and reports the run as degraded', async () => {
      const stub = {
        emitAsync: jest.fn().mockResolvedValue([]),
        emit: jest.fn(),
      } as unknown as EventEmitter2;

      const result = await emitIsolated(stub, EVENT, logger);

      expect(stub.emitAsync).toHaveBeenCalledWith(EVENT);
      expect(result.degraded).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cannot be enumerated'),
      );
    });

    it('falls back to a plain emit when emitAsync is unavailable', async () => {
      const stub = { emit: jest.fn() } as unknown as EventEmitter2;

      const result = await emitIsolated(stub, EVENT, logger);

      expect(stub.emit).toHaveBeenCalledWith(EVENT);
      expect(result.degraded).toBe(true);
    });

    it('never throws when the fallback emit itself fails', async () => {
      const stub = {
        emitAsync: jest.fn().mockRejectedValue(new Error('nope')),
        emit: jest.fn(),
      } as unknown as EventEmitter2;

      await expect(emitIsolated(stub, EVENT, logger)).resolves.toEqual({
        total: 0,
        failed: 1,
        degraded: true,
      });
    });
  });
});
