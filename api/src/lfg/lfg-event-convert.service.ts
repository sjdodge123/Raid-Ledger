/**
 * ROK-1573 — convert-on-create for `POST /events` with `lfgGameId`.
 *
 * Provided by `EventsModule`, not `LfgModule`: `LfgModule` already reaches
 * `EventsModule` through `NotificationModule`, so importing it back would close
 * a module cycle (spec Lane A step 6 — no `forwardRef`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type { LfgDb } from './lfg-query.helpers';
import { convertGroupToEvent } from './lfg-event-convert.helpers';
import { LFG_EVENTS, type LfgGroupChangedPayload } from './lfg.constants';

@Injectable()
export class LfgEventConvertService {
  private readonly logger = new Logger(LfgEventConvertService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Convert the creator's live LFG group to the new event.
   *
   * Never throws: the event already exists, so a failure here must not turn a
   * successful create into a 500 (Q3). A caller who is not a live participant
   * (stale tab, expired intent, group already converted) gets a plain event.
   *
   * @param userId - The event creator.
   * @param gameId - The `lfgGameId` from the request.
   * @param eventId - The event just created (occurrence 1 for a series, Q8).
   * @returns The converted members' user ids (may include the creator).
   */
  async convertForNewEvent(
    userId: number,
    gameId: number,
    eventId: number,
  ): Promise<number[]> {
    try {
      const userIds = await convertGroupToEvent(
        this.db,
        userId,
        gameId,
        eventId,
      );
      if (userIds.length === 0) {
        this.logger.warn(
          `Event ${eventId} created with lfgGameId ${gameId} by user ${userId}, but no live group converted; skipping.`,
        );
        return [];
      }
      this.emitConverted({ gameId, reason: 'converted', eventId });
      return userIds;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `LFG conversion for event ${eventId} (game ${gameId}) failed: ${message}`,
      );
      return [];
    }
  }

  /** Post-commit: the transaction above has resolved before this runs. */
  private emitConverted(payload: LfgGroupChangedPayload): void {
    this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, payload);
  }
}
