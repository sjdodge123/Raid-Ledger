import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { ServerPresenceReader } from '../../plugins/pelican/presence/server-presence.reader';
import type {
  ServerPresencePlayer,
  ServerPresenceSink,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { ServerPathVoiceTally } from './ad-hoc-server-voice-tally.service';
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { ChannelBindingsService } from './channel-bindings.service';
import {
  checkSuppression,
  type SpawnClearance,
} from './ad-hoc-spawn-clearance';
import { SUPPRESSION_WINDOW_EVENTS } from './suppression-window-events';
import type { SuppressionWindowHook } from './ad-hoc-suppression.helpers';
import { getEventById } from './ad-hoc-event.helpers';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
} from '../discord-bot.constants';
import { PendingServerPlayers } from './ad-hoc-server-pending';
import {
  enrolGame,
  enrolTrackerInto,
  hasAnyoneToEnrol,
  hasTrackedPlayers,
  isServerRowJoin,
  lazyReader,
  attachUnenrolled,
  openServerRows,
  type EnrolDeps,
} from './ad-hoc-server-enrol.helpers';
import {
  SERVER_TRACKER_ENROL,
  type ServerTrackerEnrolPayload,
} from './ad-hoc-voice-leave-server.helpers';
import {
  afterServerLeave,
  announceServerSpawn,
  closeServerRows,
  refreshLive,
  type PresenceEffectsDeps,
  type SpawnPlan,
} from './ad-hoc-server-presence.effects';
import {
  buildServerSpawnInput,
  spawnOrFindServerQuickPlay,
  type ServerSpawnInput,
} from './ad-hoc-server-spawn.helpers';
import {
  DEFAULT_SERVER_MIN_PLAYERS,
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
  findServerEnrolledEvent,
  listServerEnrolledEvents,
  renameSteamOnlyRow,
  serverSourceKey,
  type LiveGameEvent,
} from './ad-hoc-server-presence.helpers';

/**
 * ROK-1800 — Quick Play's side of the Pelican server-presence seam.
 *
 * Same rules as the voice path: the `AD_HOC_EVENTS_ENABLED` kill switch, the
 * binding's `minPlayers` (default 2) before a spawn, the ROK-959 suppression
 * guard (game-scoped: no channel), and the grace job once nobody is left.
 * One Quick Play per game — a join attaches to the game's live event first.
 */
@Injectable()
export class AdHocServerPresenceService implements ServerPresenceSink {
  private readonly logger = new Logger(AdHocServerPresenceService.name);
  /** Players present before the threshold is met, per Pelican server. */
  private readonly pending = new PendingServerPlayers();
  /** Per-game serialisation: one spawn decision at a time. */
  private readonly chains = new Map<number, Promise<unknown>>();
  private readonly onWindowExtended: SuppressionWindowHook = (p) =>
    this.eventEmitter.emit(SUPPRESSION_WINDOW_EVENTS.EXTENDED, p);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly adHocEventService: AdHocEventService,
    private readonly participantService: AdHocParticipantService,
    private readonly notificationService: AdHocNotificationService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly gracePeriodQueue: AdHocGracePeriodQueueService,
    private readonly gateway: AdHocEventsGateway,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(ServerPathVoiceTally)
    private readonly voiceTally: ServerPathVoiceTally | null = null,
    // Codex r2 P1: a `| null` union emits `Object` as design:paramtypes, so
    // without an explicit token Nest never injects ModuleRef (reader = null).
    @Optional()
    @Inject(ModuleRef)
    private readonly moduleRef: ModuleRef | null = null,
  ) {}

  playerJoined(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void> {
    return this.serial(source.gameId, async () => {
      if (!(await this.adHocEventService.isEnabled())) return;
      const live = await findLiveGameAdHocEvent(this.db, source.gameId);
      if (live) return this.attachWithPending(live, source, [player]);
      await this.joinPending(source, player);
    });
  }

  playerRenamed(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void> {
    return this.serial(source.gameId, async () => {
      this.pending.rename(source.pelicanServerId, player);
      const live = await this.enrolledEvent(source, player.steamId);
      if (!live) return;
      await renameSteamOnlyRow(this.db, live.id, player);
      await refreshLive(this.fx, live);
    });
  }

  playerLeft(source: ServerPresenceSource, steamId: string): Promise<void> {
    return this.serial(source.gameId, async () => {
      this.pending.remove(source.pelicanServerId, steamId);
      const live = await this.enrolledEvent(source, steamId);
      if (!live) return;
      const id = source.pelicanServerId;
      if (await this.participantService.markServerLeave(live.id, steamId, id))
        await afterServerLeave(this.fx, live);
    });
  }

  serverEmptied(source: ServerPresenceSource): Promise<void> {
    return this.serial(source.gameId, async () => {
      this.pending.clear(source.pelicanServerId);
      const { gameId, pelicanServerId: id } = source;
      for (const live of await listServerEnrolledEvents(this.db, gameId, id))
        await closeServerRows(this.fx, live, source.pelicanServerId);
    });
  }

  /**
   * ROK-1802: a fresh session (or a stopped server's cleanup) asks, so this
   * server's held players are unverified — one may have left while nobody
   * watched. Keep them, unconfirmed: a join line re-confirms one, and a
   * heartbeat count (`playerCount`) covers or drops them, oldest first.
   */
  async openPresence(
    source: ServerPresenceSource,
  ): Promise<ServerPresencePlayer[]> {
    this.pending.unconfirm(source.pelicanServerId);
    return openServerRows(this.fx, source.gameId, source.pelicanServerId);
  }

  /**
   * Codex r4: this server's held players, oldest first. A heartbeat can enrol
   * one the new session's tracker never saw, so the session asks for them to
   * report their disconnect lines and count drops as `playerLeft`.
   */
  heldPresence(source: ServerPresenceSource): Promise<ServerPresencePlayer[]> {
    return Promise.resolve(this.pending.all(source.pelicanServerId));
  }

  /**
   * ROK-1802: a live heartbeat's player count. Unconfirmed holds that it
   * covers become enrollable — they may now reach the threshold, or join
   * the game's live event; ones it cannot cover are dropped. Players
   * already enrolled on this server are part of the count (Codex r2): a
   * stale hold must not ride in on their heads.
   */
  playerCount(source: ServerPresenceSource, count: number): Promise<void> {
    const id = source.pelicanServerId;
    if (!this.pending.hasUnconfirmed(id)) return Promise.resolve();
    return this.serial(source.gameId, async () => {
      const rows = await openServerRows(
        this.fx,
        source.gameId,
        source.pelicanServerId,
      );
      const enrolled = new Set(rows.map((r) => r.steamId));
      // Codex r3: an enrolled player's own hold must not take a cover slot.
      for (const steamId of enrolled) this.pending.remove(id, steamId);
      if (!this.pending.reconcile(id, count - enrolled.size)) return;
      if (!(await this.adHocEventService.isEnabled())) return;
      const live = await findLiveGameAdHocEvent(this.db, source.gameId);
      if (live) return this.attachWithPending(live, source, []);
      await this.evaluate(source);
    });
  }

  /**
   * Codex r2: a live event born elsewhere (voice, or another server) takes
   * every player any server of its game is holding below `minPlayers` —
   * unchanged heartbeats never call the sink again, so nothing else would.
   * ROK-1821: and every player the tracker reports, held or not (RCA F1).
   * ROK-1822: a server row's own join skips it — its attach already ran one.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)
  async onParticipantJoined(p: AdHocParticipantJoinedPayload): Promise<void> {
    if (isServerRowJoin(p)) return;
    try {
      const gameId = (await getEventById(this.db, p.eventId))?.gameId;
      if (!gameId || !hasAnyoneToEnrol(this.enrol, gameId)) return;
      await this.serial(gameId, async () => {
        const live = await findLiveGameAdHocEvent(this.db, gameId);
        if (live) await enrolGame(this.enrol, gameId, live);
      });
    } catch (err) {
      this.logger.warn(`Pending drain for event ${p.eventId} failed: ${err}`);
    }
  }

  /**
   * ROK-1821 safety net: a voice leave found nobody open on the server while
   * the tracker reports players — enrol them into that event now. True only
   * when the event (still live) has someone open on a server afterwards.
   */
  @OnEvent(SERVER_TRACKER_ENROL)
  onTrackerEnrol(p: ServerTrackerEnrolPayload): Promise<boolean> {
    if (!hasTrackedPlayers(this.reader, p.gameId))
      return Promise.resolve(false);
    return this.serial<boolean>(p.gameId, () =>
      enrolTrackerInto(this.enrol, p.eventId, p.gameId),
    );
  }

  // ─── Private ──────────────────────────────────────────

  /** The tracker, resolved per call (review BLOCKER 1 — see `lazyReader`). */
  private get reader(): ServerPresenceReader | null {
    return lazyReader(this.moduleRef);
  }

  private get enrol(): EnrolDeps {
    return { fx: this.fx, pending: this.pending, reader: this.reader };
  }

  private get fx(): PresenceEffectsDeps {
    return {
      db: this.db,
      adHocEventService: this.adHocEventService,
      participantService: this.participantService,
      notificationService: this.notificationService,
      channelBindingsService: this.channelBindingsService,
      gracePeriodQueue: this.gracePeriodQueue,
      gateway: this.gateway,
    };
  }

  /** The live event `steamId` is enrolled in on THIS server (Codex r2/r3). */
  private enrolledEvent(source: ServerPresenceSource, steamId: string) {
    const { gameId, pelicanServerId } = source;
    return findServerEnrolledEvent(this.db, gameId, steamId, pelicanServerId);
  }

  /** Run `fn` after every earlier call for the same game has settled. */
  private serial<T = void>(gameId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(gameId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      gameId,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * Attach `players` plus everyone this server held below the threshold — a
   * live event that appeared meanwhile (e.g. voice-born) takes them all, and
   * then every player the tracker reports for the game (ROK-1821). A player
   * already open on this server in a live event of the game (enrolled by an
   * earlier `enrolGame` of this replay) is not attached again (Codex r3); one
   * open on another server moves here (Codex r4).
   */
  private async attachWithPending(
    live: LiveGameEvent,
    source: ServerPresenceSource,
    players: ServerPresencePlayer[],
  ): Promise<void> {
    const all = new Map(
      this.pending.take(source.pelicanServerId).map((pl) => [pl.steamId, pl]),
    );
    for (const pl of players) all.set(pl.steamId, pl);
    await attachUnenrolled(this.fx, live, source, [...all.values()]);
    await enrolGame(this.enrol, source.gameId, live, source.pelicanServerId);
  }

  /**
   * Hold the player, run the ROK-959 guard, then spawn at the threshold. The
   * guard runs first, as on the voice path (`suppressOrCheckThreshold`), so a
   * lone server player still extends a live scheduled event for the game —
   * `minPlayers` gates only the spawn (Codex r4).
   */
  private async joinPending(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void> {
    this.pending.hold(source, player);
    await this.evaluate(source);
  }

  /** The spawn gate over this server's enrollable holds (ROK-1802 split). */
  private async evaluate(source: ServerPresenceSource): Promise<void> {
    const held = this.pending.players(source.pelicanServerId).length;
    const clearance = await checkSuppression(
      this.db,
      serverSourceKey(source.pelicanServerId),
      source.gameId,
      undefined,
      this.onWindowExtended,
    );
    if (!clearance) return;
    const binding = await findGameVoiceBinding(this.db, source.gameId);
    const min = binding?.config?.minPlayers ?? DEFAULT_SERVER_MIN_PLAYERS;
    const voice = await this.voiceTally?.countFor(source, this.pending);
    if (held + (voice?.counted ?? 0) < min) return;
    // Codex r3 P2: a presence-null voice member counts but, as on the voice
    // path (`resolveGameBindingSpawn`), takes the delayed spawn — the CHANGED
    // re-check that follows this batch arms the monitor's 15-minute timer.
    if ((voice?.unconfirmed ?? 0) > 0) return;
    const players = this.pending.players(source.pelicanServerId);
    const plan = { source, binding, players };
    // Only the enrolled leave the hold; uncovered ones wait for a heartbeat.
    if (await this.spawn(plan, clearance))
      this.pending.take(source.pelicanServerId);
  }

  /**
   * Create the event (ROK-1456: only with a fresh receipt) and enrol everyone
   * atomically, under the game's spawn lock; a live event that won the race
   * (voice or another process) takes the players instead.
   */
  private async spawn(
    plan: SpawnPlan,
    clearance: SpawnClearance,
  ): Promise<boolean> {
    const { source, binding, players } = plan;
    const key = serverSourceKey(source.pelicanServerId);
    if (!clearance.matches(key, source.gameId) || !clearance.consume())
      return false;
    const input = await buildServerSpawnInput(
      this.db,
      source,
      binding?.id ?? null,
      players,
    );
    if (!input) return false;
    const result = await spawnOrFindServerQuickPlay(this.db, input);
    if (result.kind === 'existing') {
      await this.attachWithPending(result.live, source, players);
      return true;
    }
    await this.afterSpawn(result.eventId, plan, input, result.joined);
    return true;
  }

  /** Post-commit side effects of a server-born spawn. */
  private async afterSpawn(
    eventId: number,
    plan: SpawnPlan,
    input: ServerSpawnInput,
    joined: (number | null)[],
  ): Promise<void> {
    if (input.bindingId)
      this.adHocEventService.adoptEvent(input.bindingId, input.gameId, eventId);
    for (const userId of joined)
      this.eventEmitter.emit(AD_HOC_EVENTS.PARTICIPANT_JOINED, {
        eventId,
        userId,
      });
    await announceServerSpawn(this.fx, eventId, plan, input.ids);
    const live = {
      id: eventId,
      channelBindingId: input.bindingId,
      adHocStatus: 'live',
    };
    await enrolGame(this.enrol, input.gameId, live, input.pelicanServerId);
    this.logger.log(
      `Server ${serverSourceKey(input.pelicanServerId)} spawned Quick Play ${eventId}`,
    );
  }
}
