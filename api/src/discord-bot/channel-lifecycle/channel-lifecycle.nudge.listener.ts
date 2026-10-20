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
    GameActivityNudge.safeTouch(this.nudge, readLifecycleGameId(payload));
  }

  /** An edited / rescheduled event may have moved to a different game. */
  @OnEvent(APP_EVENT_EVENTS.UPDATED)
  handleEventUpdated(payload: unknown): void {
    GameActivityNudge.safeTouch(this.nudge, readLifecycleGameId(payload));
  }
}
