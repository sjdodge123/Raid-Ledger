/**
 * ROK-1446 — ChannelPresenceEmbedService: ONE live message per bound
 * `general-lobby` voice channel, edited in place as the room changes.
 *
 * Replaces the per-spawn announcement for lobby bindings (D9): instead of a
 * message per ad-hoc event, a room gets a single message carrying a lead embed
 * plus one embed per detected game group, and that message becomes the recap
 * when the room empties. `game-voice-monitor` bindings are OUT of scope (D1)
 * and keep the ROK-1447 per-event card unchanged.
 *
 * Design invariants this service exists to hold:
 * - **Render from truth (D4).** Every flush re-derives the room from Discord +
 *   the DB. Nothing is reconstructed from deltas, so a missed voice event
 *   self-heals on the next tick.
 * - **Batched edit-in-place (D5).** `markDirty` only sets a flag; a 5 s timer
 *   drains the dirty set, one send/edit per channel per tick, and a render
 *   whose payload hash is unchanged issues NO edit at all.
 * - **The DB is truth, memory is a cache (D7).** `discord_channel_presence_messages`
 *   holds the open row, so the message survives a bot restart and `recover()`
 *   can re-adopt it rather than posting a duplicate.
 *
 * **Lane A spawn 1 (skeleton).** The six public methods below are frozen —
 * Lane B's voice hooks, its D9 suppression gate and its D12 controller all
 * compile against these signatures. Bodies are intentionally no-ops; the flush
 * loop, `ensureMessage`, the empty → recap → close ladder (D8) and the cron
 * reaper (D7) land in the following Lane A spawns.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import type { RoomSnapshot } from './channel-presence-room.helpers';

@Injectable()
export class ChannelPresenceEmbedService {
  private readonly logger = new Logger(ChannelPresenceEmbedService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly presenceDetector: PresenceGameDetectorService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Mark a bound lobby voice channel as needing a re-render on the next tick.
   *
   * Cheap and synchronous by contract — every voice hook (D6) calls it on the
   * hot path, and 20 calls inside one interval must still cost exactly one
   * edit (AC5). Calls that arrive before `recover()` has run only accumulate,
   * so nothing is posted before open rows have been adopted.
   */
  markDirty(channelId: string): void {
    // ROK-1446 Lane A spawn 1 — signature frozen for Lane B; the dirty set and
    // flush loop (D5) land in the next Lane A spawn.
    void channelId;
  }

  /**
   * An ad-hoc event under this binding finished (D8/D9).
   *
   * Called from `AdHocNotificationService.notifyCompleted` so the completion
   * folds into the room's existing message — a lobby event never posts its own
   * completion embed.
   */
  onEventEnded(bindingId: string): void {
    // ROK-1446 Lane A spawn 1 — no-op skeleton.
    void bindingId;
  }

  /**
   * Re-adopt every open presence row after a bot reconnect (D7, AC8).
   *
   * Runs BEFORE `recoverFromVoiceChannels` so a channel that is still occupied
   * edits the existing message instead of posting a second one. A message that
   * Discord no longer has (10008) closes its row with `close_reason='missing'`.
   */
  recover(): Promise<void> {
    // ROK-1446 Lane A spawn 1 — no-op skeleton.
    return Promise.resolve();
  }

  /** Drop all in-memory state on bot disconnect. Never touches the DB. */
  clear(): void {
    // ROK-1446 Lane A spawn 1 — no-op skeleton.
  }

  /**
   * DEMO_MODE seam (D12): stand in for the Discord read + detection step of
   * `resolveRoom` for one channel. `null` clears the override.
   *
   * Everything downstream — partition, linked-event lookup, render, post/edit,
   * persistence, close — still runs for real, which is what lets the companion
   * bot smoke the rendered message despite bots being filtered from rooms.
   */
  setRoomOverride(
    channelId: string,
    snapshot: RoomSnapshot | null,
  ): Promise<void> {
    // ROK-1446 Lane A spawn 1 — no-op skeleton.
    void channelId;
    void snapshot;
    return Promise.resolve();
  }

  /**
   * Drain the dirty set immediately instead of waiting for the timer.
   *
   * Used by the D12 seam so a smoke test can assert against the rendered
   * message without polling through a 5 s tick.
   */
  flushNow(): Promise<void> {
    // ROK-1446 Lane A spawn 1 — no-op skeleton.
    return Promise.resolve();
  }
}
