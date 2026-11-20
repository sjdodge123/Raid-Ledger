/**
 * ROK-2271 review MAJOR-1 (fix round 2) — the signal a confirmation reset
 * sends the event thread's signup lines, in three steps around the write:
 * STARTING is awaited BEFORE it (the thread flags the reset, so a flush
 * racing the write already re-syncs silently), ABORTED clears that flag
 * when the write throws, LANDED (after the commit) re-arms the flush.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SIGNUP_CONFIRMATIONS_RESET,
  SIGNUP_CONFIRMATIONS_RESETTING,
} from '../discord-bot/discord-bot.constants';

/** What the reset needs from the emitter. */
export type ResetSignalEmitter = Pick<EventEmitter2, 'emit' | 'emitAsync'>;

/** Awaited before the reset write. */
export async function signalResetStarting(
  emitter: ResetSignalEmitter,
  eventId: number,
): Promise<void> {
  await emitter.emitAsync(SIGNUP_CONFIRMATIONS_RESETTING, { eventId });
}

/** The reset write threw: drop the pending flag. */
export async function signalResetAborted(
  emitter: ResetSignalEmitter,
  eventId: number,
): Promise<void> {
  await emitter.emitAsync(SIGNUP_CONFIRMATIONS_RESETTING, {
    eventId,
    aborted: true,
  });
}

/** The reset is committed: re-arm the thread's flush. */
export function signalResetLanded(
  emitter: ResetSignalEmitter,
  eventId: number,
): void {
  emitter.emit(SIGNUP_CONFIRMATIONS_RESET, { eventId });
}
