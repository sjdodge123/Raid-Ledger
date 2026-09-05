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
 * The six public methods are FROZEN — Lane B's voice hooks, its D9 suppression
 * gate and its D12 controller all compile against these signatures.
 *
 * This class deliberately owns only the dirty set, the timer, the `ready` gate
 * and the cron entry point. The whole send/edit/recap/close ladder lives in
 * `channel-presence-flush.ts`, which is a plain function and therefore
 * assertable without standing up a Nest module.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { fetchMessageOrNull } from '../discord-bot-client.messages.helpers';
import {
  resolveAllBindings,
  type ResolvedBinding,
} from '../listeners/voice-state.helpers';
import { flushChannel } from './channel-presence-flush';
import type {
  RoomResolveDeps,
  RoomSnapshot,
} from './channel-presence-room.helpers';
import { closeRow, listOpenRows } from './channel-presence-store.helpers';

/**
 * How often the dirty set drains (D5).
 *
 * Deliberately identical to `AdHocNotificationService`'s
 * `BATCH_FLUSH_INTERVAL_MS`: the room message replaces the per-event cards for
 * lobby bindings, so the two surfaces must not update on different cadences.
 * A unit pin in `ad-hoc-notification.service.lobby-suppression.spec.ts` reads
 * this identifier out of this file's source and asserts the equality.
 */
export const PRESENCE_FLUSH_INTERVAL_MS = 5000;

/** The binding purpose this service renders for; monitors are out of scope (D1). */
const LOBBY_PURPOSE = 'general-lobby';

/**
 * How many extra ticks a channel whose flush threw is retried for (S-1).
 *
 * Bounded on purpose. A failed FIRST occupancy leaves no row, so the cron
 * reaper — which iterates `listOpenRows` — cannot recover it and the room would
 * silently never get a message (AC1). Re-queuing unconditionally would instead
 * spin a permanently broken channel every 5 s forever, so the counter caps the
 * retries and then drops the channel with an `error` log; the next real voice
 * event marks it dirty again.
 */
const MAX_FLUSH_RETRIES = 3;

/** How many already-running ticks `flushNow` will wait behind before it runs. */
const FLUSH_NOW_MAX_WAITS = 3;

@Injectable()
export class ChannelPresenceEmbedService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChannelPresenceEmbedService.name);

  /** Voice channels needing a re-render on the next tick (D5). */
  private readonly dirty = new Set<string>();

  /** Bindings whose event just ended; resolved to channels at drain time (D8). */
  private readonly dirtyBindings = new Set<string>();

  /** DEMO_MODE room overrides, keyed by voice channel (D12). */
  private readonly overrides = new Map<string, RoomSnapshot>();

  /**
   * TTL cache for `resolveAllBindings`, as the voice listener keeps.
   *
   * Typed off the helper's own parameter rather than restated: `BindingCacheEntry`
   * is module-private in `voice-state.helpers.ts`, which Lane B owns, and
   * exporting it from here would be an edit to that lane's file.
   */
  private readonly bindingCache: Parameters<typeof resolveAllBindings>[2] =
    new Map();

  /**
   * False until `recover()` has adopted the open rows (D5/D7).
   *
   * Nothing may post before adoption: a flush that ran first would find no row
   * in memory, post a second message, and leave the pre-restart one orphaned.
   */
  private ready = false;

  /** Re-entrancy guard — a slow tick must never overlap the next one. */
  private flushing = false;

  /**
   * The tick currently running, so `flushNow` can await it (S-6).
   *
   * Without this the D12 seam inherits the `flushing` early return, returns
   * HTTP 200 having rendered nothing, and the smoke test that polls the
   * response's `messageId` fails as an unexplained timeout instead of naming
   * the real fault.
   */
  private inFlight: Promise<void> | null = null;

  /** Consecutive failed flushes per channel; the S-1 retry budget. */
  private readonly flushFailures = new Map<string, number>();

  private timer: NodeJS.Timeout | null = null;

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

  /** Start the 5 s drain (D5). */
  onModuleInit(): void {
    this.timer ??= setInterval(() => {
      // `.catch` is not decorative: an unguarded rejection out of a `void`-ed
      // async call is an unhandled promise rejection, which on Node's default
      // terminates the API process.
      void this.drain().catch((error: unknown) => {
        this.logger.error(`Presence drain failed: ${String(error)}`);
      });
    }, PRESENCE_FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Stop the drain so a torn-down module leaves no live handle. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Mark a bound lobby voice channel as needing a re-render on the next tick.
   *
   * Cheap and synchronous by contract — every voice hook (D6) calls it on the
   * hot path, and 20 calls inside one interval must still cost exactly one
   * edit (AC5). Calls that arrive before `recover()` has run only accumulate,
   * so nothing is posted before open rows have been adopted.
   */
  markDirty(channelId: string): void {
    this.dirty.add(channelId);
  }

  /**
   * An ad-hoc event under this binding finished (D8/D9).
   *
   * Called from `AdHocNotificationService.notifyCompleted` so the completion
   * folds into the room's existing message — a lobby event never posts its own
   * completion embed. The binding is resolved to its voice channel at drain
   * time, which keeps this synchronous for its caller.
   */
  onEventEnded(bindingId: string): void {
    this.dirtyBindings.add(bindingId);
  }

  /**
   * Re-adopt every open presence row after a bot reconnect (D7, AC8).
   *
   * Runs BEFORE `recoverFromVoiceChannels` so a channel that is still occupied
   * edits the existing message instead of posting a second one. A message that
   * Discord no longer has (10008) closes its row with `close_reason='missing'`.
   *
   * Idempotent: adoption posts nothing, so recovering the same row twice
   * leaves exactly one message.
   */
  async recover(): Promise<void> {
    try {
      await this.adoptOpenRows();
    } catch (error) {
      // `listOpenRows` is the one call the per-row catch cannot cover. If a DB
      // blip escaped here, `ready` would stay false for the life of the process
      // — nothing else ever sets it — so `drain()` would never run again while
      // `dirty` grew unbounded. Degrade instead: adopting nothing is safe
      // because `flushChannel` re-checks the DB for an open row before posting.
      this.logger.error(
        `Presence recovery failed; continuing degraded: ${String(error)}`,
      );
    } finally {
      this.ready = true;
    }
  }

  /** Fetch each open row's message and adopt it, or close it if it is gone. */
  private async adoptOpenRows(): Promise<void> {
    const client = this.clientService.getClient();
    for (const row of await listOpenRows(this.db)) {
      try {
        const message = await fetchMessageOrNull(
          client,
          row.textChannelId,
          row.messageId,
        );
        if (!message) {
          await closeRow(this.db, row.id, 'missing');
          continue;
        }
        this.markDirty(row.voiceChannelId);
      } catch (error) {
        this.logger.error(
          `Failed to recover presence row ${row.id}: ${String(error)}`,
        );
      }
    }
  }

  /** Drop all in-memory state on bot disconnect. Never touches the DB. */
  clear(): void {
    this.dirty.clear();
    this.dirtyBindings.clear();
    this.overrides.clear();
    this.bindingCache.clear();
    this.flushFailures.clear();
    this.ready = false;
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
    if (snapshot === null) this.overrides.delete(channelId);
    else this.overrides.set(channelId, snapshot);
    this.markDirty(channelId);
    return Promise.resolve();
  }

  /**
   * Drain the dirty set immediately instead of waiting for the timer.
   *
   * Used by the D12 seam so a smoke test can assert against the rendered
   * message without polling through a 5 s tick.
   */
  async flushNow(): Promise<void> {
    for (
      let waits = 0;
      this.inFlight && waits < FLUSH_NOW_MAX_WAITS;
      waits += 1
    ) {
      await this.inFlight.catch(() => undefined);
    }
    if (!this.ready) {
      this.logger.warn(
        'Presence flushNow() ran before recover(); nothing was rendered',
      );
    }
    await this.drain();
  }

  /**
   * Cron entry point (D7): re-flush every open row every 5 minutes.
   *
   * This is what closes a room nobody will ever touch again — the last human
   * left, the grace elapsed, and no voice event will ever mark it dirty. Going
   * through the normal flush keeps ONE close ladder rather than a second,
   * divergent one living in the reaper.
   */
  @Cron('30 */5 * * * *', {
    name: 'ChannelPresenceEmbedService_reapStale',
    waitForCompletion: true,
  })
  async handleReapStale(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ChannelPresenceEmbedService_reapStale',
      () => this.reapStaleRows(),
    );
  }

  /** Mark every open row's room dirty, then drain. */
  async reapStaleRows(): Promise<void> {
    for (const row of await listOpenRows(this.db)) {
      this.markDirty(row.voiceChannelId);
    }
    await this.drain();
  }

  /**
   * One tick: resolve the pending bindings, then flush each dirty channel.
   *
   * Errors are caught PER CHANNEL — one unreachable room must never abort the
   * tick and strand every other room's edit.
   */
  private drain(): Promise<void> {
    if (!this.ready || this.flushing) return Promise.resolve();
    this.flushing = true;
    const run = this.tick().finally(() => {
      this.flushing = false;
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** The body of one tick; `drain` owns the re-entrancy bookkeeping. */
  private async tick(): Promise<void> {
    await this.expandDirtyBindings();
    const channels = [...this.dirty];
    this.dirty.clear();
    for (const channelId of channels) {
      await this.flushOne(channelId);
    }
  }

  /** Translate `onEventEnded(bindingId)` into dirty voice channels. */
  private async expandDirtyBindings(): Promise<void> {
    const bindingIds = [...this.dirtyBindings];
    this.dirtyBindings.clear();
    for (const bindingId of bindingIds) {
      try {
        const binding =
          await this.channelBindingsService.getBindingById(bindingId);
        if (binding?.channelId) this.markDirty(binding.channelId);
      } catch (error) {
        // Re-queue: this select is the only record that the event ended, and
        // `dirtyBindings` was already cleared. Dropping it loses the recap.
        this.dirtyBindings.add(bindingId);
        this.logger.error(
          `Failed to resolve ended-event binding ${bindingId}: ${String(error)}`,
        );
      }
    }
  }

  /** Flush one channel, swallowing (but logging and re-queuing) its failure. */
  private async flushOne(channelId: string): Promise<void> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.requeue(channelId);
      return;
    }
    try {
      await flushChannel({
        deps: this.resolveDeps(),
        channelId,
        guildId,
        binding: await this.lobbyBinding(channelId),
        override: this.overrides.get(channelId) ?? null,
        logger: this.logger,
      });
      this.flushFailures.delete(channelId);
    } catch (error) {
      this.requeue(channelId);
      this.logger.error(
        `Presence flush failed for channel ${channelId}: ${String(error)}`,
      );
    }
  }

  /**
   * Put a channel back in the dirty set after a flush that did not complete.
   *
   * `drain` clears `dirty` before flushing, so without this a failed first
   * occupancy is unrecoverable: no row exists, so the cron reaper has nothing
   * to re-mark and the room stays messageless until the next voice event.
   */
  private requeue(channelId: string): void {
    const failures = (this.flushFailures.get(channelId) ?? 0) + 1;
    if (failures > MAX_FLUSH_RETRIES) {
      this.flushFailures.delete(channelId);
      this.logger.error(
        `Presence flush for channel ${channelId} failed ${String(failures)} times; dropping until the next voice event`,
      );
      return;
    }
    this.flushFailures.set(channelId, failures);
    this.dirty.add(channelId);
  }

  /** The `general-lobby` binding owning this voice channel, if any (D1). */
  private async lobbyBinding(
    channelId: string,
  ): Promise<ResolvedBinding | null> {
    const bindings = await resolveAllBindings(
      {
        clientService: this.clientService,
        channelBindingsService: this.channelBindingsService,
      },
      channelId,
      this.bindingCache,
    );
    return bindings.find((b) => b.bindingPurpose === LOBBY_PURPOSE) ?? null;
  }

  /** Injected services, in the shape the room/flush helpers expect. */
  private resolveDeps(): RoomResolveDeps {
    return {
      db: this.db,
      channelBindingsService: this.channelBindingsService,
      channelResolver: this.channelResolver,
      settingsService: this.settingsService,
      clientService: this.clientService,
      presenceDetector: this.presenceDetector,
    };
  }
}
