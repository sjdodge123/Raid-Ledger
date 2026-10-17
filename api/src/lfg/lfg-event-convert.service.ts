/**
 * ROK-1573 — convert-on-create for `POST /events` with `lfgGameId`.
 *
 * Provided by `EventsModule`, not `LfgModule`: `LfgModule` already reaches
 * `EventsModule` through `NotificationModule`, so importing it back would close
 * a module cycle (spec Lane A step 6 — no `forwardRef`).
 */
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type { LfgDb } from './lfg-query.helpers';
import {
  createAndConvertGroup,
  type LfgGroupCreateResult,
} from './lfg-event-convert.helpers';
import { LFG_EVENTS, type LfgGroupChangedPayload } from './lfg.constants';

@Injectable()
export class LfgEventConvertService {
  private readonly logger = new Logger(LfgEventConvertService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create an event from the caller's live LFG group and convert the group.
   *
   * @param userId - The event creator.
   * @param gameId - The `lfgGameId` from the request.
   * @param createEvent - Creates the event; not called on a 409.
   * @returns The event and the converted members' user ids.
   * @throws ConflictException (409) when the caller holds no live intent —
   *   a concurrent Lock-in already converted the group, or they withdrew.
   */
  async createForGroup<T extends { id: number }>(
    userId: number,
    gameId: number,
    createEvent: () => Promise<T>,
  ): Promise<LfgGroupCreateResult<T>> {
    let created: T | undefined;
    const create = async () => (created = await createEvent());
    try {
      const result = await createAndConvertGroup(
        this.db,
        userId,
        gameId,
        create,
      );
      this.emitConverted({
        gameId,
        reason: 'converted',
        eventId: result.event.id,
      });
      return result;
    } catch (error) {
      if (error instanceof ConflictException || created === undefined) {
        throw error;
      }
      return this.plainEventFallback(created, gameId, error);
    }
  }

  /** The event committed but the conversion failed: keep it, don't 500. */
  private plainEventFallback<T extends { id: number }>(
    event: T,
    gameId: number,
    error: unknown,
  ): LfgGroupCreateResult<T> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `LFG conversion for event ${event.id} (game ${gameId}) failed: ${message}`,
    );
    return { event, memberIds: [] };
  }

  /** Post-commit: the transaction above has resolved before this runs. */
  private emitConverted(payload: LfgGroupChangedPayload): void {
    this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, payload);
  }
}
