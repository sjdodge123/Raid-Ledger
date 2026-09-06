/**
 * The LFG "playing now" trigger (ROK-1494 D1).
 *
 * Lives on the discord-bot side, NOT inside `LfgService`: `discord-bot` already
 * imports `lfg`, never the reverse, and spawning from the service would need
 * `EphemeralVoiceService` injected into `lfg` — a module cycle.
 *
 * Every entry point catches and warns. `LFM_REACHED`'s call stack is
 * `POST /lfg`, so a throw here would turn a successful hand-raise into a 500;
 * a spawn failure must leave the group as an ordinary LFM instead.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  LFG_EVENTS,
  type LfgGroupChangedPayload,
  type LfgLfmReachedPayload,
} from '../../lfg/lfg.constants';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
  type AdHocParticipantLeftPayload,
} from '../discord-bot.constants';
import { EphemeralVoiceService } from '../services/ephemeral-voice.service';
import { SettingsService } from '../../settings/settings.service';
import { LFG_NOW_LOG_TAG } from './lfg-now.constants';
import { spawnUnderGroupLock } from './lfg-now-spawn.helpers';
import {
  loadLfgNowEphemeralRow,
  lfgNowEventGameId,
} from './lfg-now.db-helpers';

/** Reasons that can move a group across the now-threshold (A9). */
const SPAWN_REASONS: ReadonlySet<string> = new Set(['joined', 'bumped']);

@Injectable()
export class LfgNowSpawnService {
  private readonly logger = new Logger(LfgNowSpawnService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(EphemeralVoiceService)
    private readonly ephemeralVoice: EphemeralVoiceService | null = null,
    @Optional()
    @Inject(SettingsService)
    private readonly settings: SettingsService | null = null,
  ) {}

  /**
   * The 1 → 2 transition. `urgency` is the cheap filter; the authoritative
   * now-count is re-read under the advisory lock, because the payload does not
   * carry one and a count read outside the lock would be a moving target.
   *
   * @param payload - The LFM_REACHED payload.
   */
  @OnEvent(LFG_EVENTS.LFM_REACHED)
  async onLfmReached(payload: LfgLfmReachedPayload): Promise<void> {
    if (payload?.urgency !== 'now') return;
    await this.trySpawn(payload.gameId);
  }

  /**
   * A group already at LFM changed shape. `joined` covers AC5's mixed group
   * (at three total the write side emits GROUP_CHANGED, never LFM_REACHED) and
   * `bumped` covers a member flipping their own hand to `now`. Without either
   * branch those two paths would silently never spawn.
   *
   * @param payload - The GROUP_CHANGED payload.
   */
  @OnEvent(LFG_EVENTS.GROUP_CHANGED)
  async onGroupChanged(payload: LfgGroupChangedPayload): Promise<void> {
    if (!payload || !SPAWN_REASONS.has(payload.reason)) return;
    await this.trySpawn(payload.gameId);
  }

  /**
   * A voice joiner landed on the roster — re-render the post.
   *
   * @param payload - The PARTICIPANT_JOINED payload.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)
  async onParticipantJoined(
    payload: AdHocParticipantJoinedPayload,
  ): Promise<void> {
    await this.announceRosterChange(payload?.eventId);
  }

  /**
   * A voice joiner left — re-render the post (D5's mirror).
   *
   * @param payload - The PARTICIPANT_LEFT payload.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_LEFT)
  async onParticipantLeft(payload: AdHocParticipantLeftPayload): Promise<void> {
    await this.announceRosterChange(payload?.eventId);
  }

  /** Spawn or attach for one game, then create voice and announce. */
  private async trySpawn(gameId: number): Promise<void> {
    try {
      const result = await spawnUnderGroupLock(this.db, gameId);
      if (!result) return;
      // A voice-creation failure must NOT suppress the announcement: the event
      // exists, `ephemeral_voice_channel_id` simply stays NULL and the surfaces
      // render the event link alone (error matrix / D9's nullable channel id).
      if (result.spawned) {
        await this.createPublicVoice(result.eventId).catch((err) =>
          this.logger.warn(
            `${LFG_NOW_LOG_TAG} temp voice failed for event ${result.eventId}: ${err}`,
          ),
        );
      }
      this.emitPlaying(gameId, result.eventId);
    } catch (err) {
      // Never rethrow: this handler's stack is POST /lfg.
      this.logger.warn(
        `${LFG_NOW_LOG_TAG} spawn failed for game ${gameId}: ${err}`,
      );
    }
  }

  /**
   * D6/Q2: call `createForEvent` DIRECTLY, without `shouldCreate`, so the
   * session gets its channel even on an instance whose ephemeral-voice master
   * toggle is OFF. The gate helper itself is untouched — every other caller
   * keeps its ROK-1352 semantics. The event row carries
   * `ephemeral_voice_enabled = true`, which is the reason an admin already sees.
   */
  private async createPublicVoice(eventId: number): Promise<void> {
    if (!this.ephemeralVoice) return;
    const row = await loadLfgNowEphemeralRow(this.db, eventId);
    if (!row) return;
    const master = await this.settings?.getEphemeralVoiceEnabled();
    this.logger.log(
      `${LFG_NOW_LOG_TAG} creating public temp voice for LFG event ${eventId} ` +
        `(ephemeral-voice master toggle = ${String(master)}; gate bypassed by Q2)`,
    );
    await this.ephemeralVoice.createForEvent(row);
  }

  /** Re-emit `playing` for an LFG-born event whose roster moved. */
  private async announceRosterChange(eventId?: number): Promise<void> {
    if (!eventId) return;
    try {
      const gameId = await lfgNowEventGameId(this.db, eventId);
      if (gameId === null) return;
      this.emitPlaying(gameId, eventId);
    } catch (err) {
      this.logger.warn(
        `${LFG_NOW_LOG_TAG} roster re-render failed for event ${eventId}: ${err}`,
      );
    }
  }

  /**
   * D4: `playing`, never `converted`. `converted` renders a terminal view that
   * closes the LFM row, after which the head-count could never update again.
   */
  private emitPlaying(gameId: number, eventId: number): void {
    this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, {
      gameId,
      reason: 'playing',
      eventId,
    } satisfies LfgGroupChangedPayload);
  }
}
