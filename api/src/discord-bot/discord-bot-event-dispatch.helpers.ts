/**
 * Fault-isolated fan-out for bot lifecycle events (ROK-1425 follow-up).
 *
 * `EventEmitter2.emitAsync` invokes subscribers in a plain loop with no
 * per-listener guard, so a SYNCHRONOUS throw from any one of them aborts the
 * whole chain: every subscriber registered after the thrower silently never
 * runs. Wrapping the `emitAsync` call in a try/catch — as the caller used to —
 * catches the error but does NOT resume the chain; it only makes the failure
 * loggable after the damage is done.
 *
 * That matters most for `discord-bot.connected`, which has 16 subscribers and
 * is where every gateway listener attaches its handlers. Ordering is
 * registration-dependent, so which listeners get stranded is effectively
 * arbitrary — and a stranded interaction listener means buttons that never ack,
 * i.e. Discord's red "This interaction failed" with nothing in the logs. That
 * is an unproven-but-live candidate cause for ROK-1425.
 *
 * This module enumerates the subscribers and invokes each one in its own
 * `Promise.allSettled` slot, so one failure can never prevent another
 * subscriber from running, and every failure is logged individually with the
 * position needed to identify it in a prod export.
 */
import type { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';

/** Outcome of one isolated fan-out. */
export interface IsolatedEmitResult {
  /** Subscribers invoked. */
  total: number;
  /** Subscribers that threw or rejected. The rest still ran. */
  failed: number;
  /** True when the emitter could not be enumerated and a fallback emit was used. */
  degraded: boolean;
}

type AnyListener = (...args: unknown[]) => unknown;

/** Best-effort identity for a subscriber, for log correlation. */
function describeListener(listener: AnyListener, index: number): string {
  const name = typeof listener.name === 'string' ? listener.name.trim() : '';
  return name ? `#${index} ${name}` : `#${index} <anonymous>`;
}

/**
 * Emit `event` to every subscriber, isolating failures.
 *
 * Returns counts rather than throwing: a lifecycle fan-out has no single
 * caller that can meaningfully recover, so the contract is "always attempt
 * every subscriber, always report what happened".
 */
export async function emitIsolated(
  eventEmitter: EventEmitter2,
  event: string,
  logger: Logger,
): Promise<IsolatedEmitResult> {
  // Enumeration requires a real EventEmitter2. Test doubles that only stub
  // emit/emitAsync fall back below — production always takes the isolated path.
  if (typeof eventEmitter.listeners !== 'function') {
    return fallbackEmit(eventEmitter, event, logger);
  }

  const listeners = eventEmitter.listeners(event) as AnyListener[];
  if (listeners.length === 0) {
    logger.warn(`${event}: no subscribers registered`);
    return { total: 0, failed: 0, degraded: false };
  }

  const settled = await Promise.allSettled(
    // `await` inside an async wrapper is what turns BOTH a synchronous throw
    // and a rejected promise into a rejected slot, instead of an exception
    // that unwinds the whole map() and takes the other subscribers with it.
    listeners.map(async (listener) => {
      await listener();
    }),
  );

  let failed = 0;
  settled.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    failed += 1;
    const reason: unknown = result.reason;
    logger.error(
      `${event}: subscriber ${describeListener(listeners[index], index)} failed — ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
      reason instanceof Error ? reason.stack : undefined,
    );
  });

  if (failed > 0) {
    // The point of the message: the remaining subscribers DID run. Without it,
    // a reader of the old single line could reasonably assume the chain died.
    logger.error(
      `${event}: ${failed} of ${listeners.length} subscriber(s) failed; the other ${
        listeners.length - failed
      } still ran`,
    );
  }

  return { total: listeners.length, failed, degraded: false };
}

/**
 * Last-resort emit for an emitter that cannot be enumerated. Retains the old
 * all-or-nothing semantics, so it is explicitly logged as degraded.
 */
async function fallbackEmit(
  eventEmitter: EventEmitter2,
  event: string,
  logger: Logger,
): Promise<IsolatedEmitResult> {
  logger.warn(
    `${event}: emitter cannot be enumerated — falling back to a non-isolated emit`,
  );
  try {
    if (typeof eventEmitter.emitAsync === 'function') {
      await eventEmitter.emitAsync(event);
    } else {
      eventEmitter.emit(event);
    }
  } catch (err: unknown) {
    logger.error(
      `${event}: non-isolated emit failed — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { total: 0, failed: 1, degraded: true };
  }
  return { total: 0, failed: 0, degraded: true };
}
