import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
import { GameActivityNudge } from './channel-lifecycle.nudge';

/**
 * Reads the game id off an event lifecycle payload (`buildLifecyclePayload`
 * sets `gameId: number | null`; bind/unbind UPDATED payloads may omit it).
 */
export function readLifecycleGameId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('gameId' in payload)) return null;
  const { gameId } = payload;
  return typeof gameId === 'number' ? gameId : null;
}

/**
 * ROK-1431 §2.6 — event create / update (incl. reschedule and delay, which
 * emit `event.updated`) nudges that game's channel lifecycle. Cancellation
 * emits `event.cancelled`, which is deliberately not hooked. Listening to the
 * domain events keeps `EventsService` (at its line cap) untouched.
 */
@Injectable()
export class ChannelLifecycleNudgeListener {
  constructor(private readonly nudge: GameActivityNudge) {}

  /** A new event (each recurring instance emits its own) is game activity. */
  @OnEvent(APP_EVENT_EVENTS.CREATED)
  handleEventCreated(payload: unknown): void {
    this.touch(payload);
  }

  /** An edited / rescheduled event may have moved to a different game. */
  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  handleEventUpdated(payload: unknown): void {
    this.touch(payload);
  }

  /**
   * `safeTouch` already swallows every error, so this try/catch is the
   * listener guard's literal requirement (`event-listeners.guard.spec.ts`):
   * an @OnEvent handler must never throw into the emitter.
   */
  private touch(payload: unknown): void {
    try {
      GameActivityNudge.safeTouch(this.nudge, readLifecycleGameId(payload));
    } catch {
      // never throw into the event emitter — the nudge is best-effort
    }
  }
}
