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
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import type { LfgDb } from './lfg-query.helpers';
import {
  createAndConvertGroup,
  type LfgEventPatch,
  type LfgGroupCreateResult,
} from './lfg-event-convert.helpers';
import { resolveLockInGroup } from './lfg-lock-in-group.helpers';
import { LFG_EVENTS, type LfgGroupChangedPayload } from './lfg.constants';

@Injectable()
export class LfgEventConvertService {
  private readonly logger = new Logger(LfgEventConvertService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly eventEmitter: EventEmitter2,
    private readonly registry: PluginRegistryService,
  ) {}

  /**
   * Create an event from the caller's live LFG group and convert the group.
   *
   * @param userId - The event creator.
   * @param gameId - The `lfgGameId` from the request.
   * @param createEvent - Creates the event; not called on a 409. Receives the
   *   grouping adapter's roster / instance / title for a grouped game.
   * @param groupKey - ROK-2352 `lfgGroupKey` (absent = `''`; folded games
   *   ignore it and convert every live hand).
   * @param chosenGroupKey - ROK-2352 `lfgChosenGroupKey`: the instance the
   *   creator picked when locking in the Any group (ignored otherwise).
   * @returns The event, the converted members' user ids and (grouped game)
   *   their carried character/roles.
   * @throws ConflictException (409) when the caller holds no live hand in the
   *   group — a concurrent Lock-in already converted it, or they withdrew.
   * @throws BadRequestException on a group key the adapter does not know.
   */
  async createForGroup<T extends { id: number }>(
    userId: number,
    gameId: number,
    createEvent: (patch?: LfgEventPatch) => Promise<T>,
    groupKey?: string,
    chosenGroupKey?: string,
  ): Promise<LfgGroupCreateResult<T>> {
    const group = await resolveLockInGroup(
      this.db,
      this.registry,
      gameId,
      groupKey,
      chosenGroupKey,
    );
    let created: T | undefined;
    const create = async (patch?: LfgEventPatch) =>
      (created = await createEvent(patch));
    try {
      const result = await createAndConvertGroup(
        this.db,
        userId,
        gameId,
        create,
        group,
      );
      this.emitAfterConvert(gameId, result, group.scope);
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

  /** Post-commit: converted, plus (Q1) the members' cleared `now` hands. */
  private emitAfterConvert<T extends { id: number }>(
    gameId: number,
    result: LfgGroupCreateResult<T>,
    scope: string | null,
  ): void {
    // ROK-2352 P1-5 — a keyed lock-in names its group, so only that group's
    // post renders SCHEDULED; the Any post stays open for its own hands.
    this.emitConverted({
      gameId,
      reason: 'converted',
      eventId: result.event.id,
      ...(scope ? { groupKey: scope } : {}),
    });
    const cleared = result.clearedSiblingUserIds ?? [];
    if (cleared.length > 0) {
      this.emitConverted({ gameId, reason: 'withdrawn', userIds: cleared });
    }
  }

  /** Post-commit: the transaction above has resolved before this runs. */
  private emitConverted(payload: LfgGroupChangedPayload): void {
    this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, payload);
  }
}
