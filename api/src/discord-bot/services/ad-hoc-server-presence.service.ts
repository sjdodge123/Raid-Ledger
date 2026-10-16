import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type {
  ServerPresencePlayer,
  ServerPresenceSink,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
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
import {
  findAdminFallback,
  getEventById,
  restoreFromGracePeriod,
} from './ad-hoc-event.helpers';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantJoinedPayload,
} from '../discord-bot.constants';
import { PendingServerPlayers } from './ad-hoc-server-pending';
import {
  afterServerLeave,
  announceServerSpawn,
  refreshLive,
  type PresenceEffectsDeps,
  type SpawnPlan,
} from './ad-hoc-server-presence.effects';
import {
  spawnOrFindServerQuickPlay,
  type ServerSpawnInput,
} from './ad-hoc-server-spawn.helpers';
import {
  DEFAULT_SERVER_MIN_PLAYERS,
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
  findServerEnrolledEvent,
  listOpenServerPresence,
  listServerEnrolledEvents,
  listOnServerSteamIds,
  renameSteamOnlyRow,
  resolveSteamIdentity,
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
      for (const live of await this.enrolledEvents(source))
        await this.emptyServerOn(live, source.pelicanServerId);
    });
  }

  async openPresence(
    source: ServerPresenceSource,
  ): Promise<ServerPresencePlayer[]> {
    const out: ServerPresencePlayer[] = [];
    for (const live of await this.enrolledEvents(source))
      out.push(
        ...(await listOpenServerPresence(
          this.db,
          live.id,
          source.pelicanServerId,
        )),
      );
    return out;
  }

  /**
   * Codex r2: a live event born elsewhere (voice, or another server) takes
   * every player any server of its game is holding below `minPlayers` —
   * unchanged heartbeats never call the sink again, so nothing else would.
   */
  @OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)
  async onParticipantJoined(p: AdHocParticipantJoinedPayload): Promise<void> {
    try {
      const event = await getEventById(this.db, p.eventId);
      const gameId = event?.gameId;
      if (!gameId || !this.pending.hasGame(gameId)) return;
      await this.serial(gameId, async () => {
        const live = await findLiveGameAdHocEvent(this.db, gameId);
        if (live) await this.drainGame(gameId, live);
      });
    } catch (err) {
      this.logger.warn(`Pending drain for event ${p.eventId} failed: ${err}`);
    }
  }

  // ─── Private ──────────────────────────────────────────

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

  /** Live events holding an open row on this server (Codex r2 routing). */
  private enrolledEvents(source: ServerPresenceSource) {
    return listServerEnrolledEvents(
      this.db,
      source.gameId,
      source.pelicanServerId,
    );
  }

  /** Close this server's open rows on one event; grace if it emptied. */
  private async emptyServerOn(
    live: LiveGameEvent,
    pelicanServerId: number,
  ): Promise<void> {
    const open = await listOnServerSteamIds(this.db, live.id, pelicanServerId);
    for (const steamId of open)
      await this.participantService.markServerLeave(live.id, steamId);
    if (open.length > 0) await afterServerLeave(this.fx, live);
  }

  /** Attach every server's held players for `gameId` to `live`. */
  private async drainGame(
    gameId: number,
    live: LiveGameEvent,
    exceptServerId?: number,
  ): Promise<void> {
    for (const held of this.pending.takeGame(gameId, exceptServerId))
      for (const pl of held.players)
        await this.attach(live, held.source.pelicanServerId, pl);
  }

  /** Run `fn` after every earlier call for the same game has settled. */
  private serial(gameId: number, fn: () => Promise<void>): Promise<void> {
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
   * live event that appeared meanwhile (e.g. voice-born) takes them all.
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
    for (const pl of all.values())
      await this.attach(live, source.pelicanServerId, pl);
  }

  /** Join the game's live event; a returning player lifts the grace period. */
  private async attach(
    live: LiveGameEvent,
    pelicanServerId: number,
    player: ServerPresencePlayer,
  ): Promise<void> {
    const identity = await resolveSteamIdentity(this.db, player.steamId);
    await this.participantService.addServerParticipant(live.id, {
      steamId: player.steamId,
      displayName: player.displayName,
      userId: identity?.userId ?? null,
      pelicanServerId,
    });
    await this.gracePeriodQueue.cancel(live.id);
    if (await restoreFromGracePeriod(this.db, live.id))
      this.gateway.emitStatusChange(live.id, 'live');
    await refreshLive(this.fx, live);
  }

  /** Below threshold: hold the player; at threshold: guard, then spawn. */
  private async joinPending(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void> {
    const held = this.pending.hold(source, player);
    const binding = await findGameVoiceBinding(this.db, source.gameId);
    const min = binding?.config?.minPlayers ?? DEFAULT_SERVER_MIN_PLAYERS;
    if (held < min) return;
    const clearance = await checkSuppression(
      this.db,
      serverSourceKey(source.pelicanServerId),
      source.gameId,
      undefined,
      this.onWindowExtended,
    );
    if (!clearance) return;
    const players = this.pending.players(source.pelicanServerId);
    const plan = { source, binding, players };
    if (await this.spawn(plan, clearance))
      this.pending.clear(source.pelicanServerId);
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
    const ids = await Promise.all(
      players.map((pl) => resolveSteamIdentity(this.db, pl.steamId)),
    );
    const creatorId =
      ids.find((i) => i !== null)?.userId ?? (await findAdminFallback(this.db));
    if (!creatorId) return false;
    const input: ServerSpawnInput = {
      gameId: source.gameId,
      pelicanServerId: source.pelicanServerId,
      bindingId: binding?.id ?? null,
      creatorId,
      players,
      ids,
    };
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
    await this.drainGame(input.gameId, live, input.pelicanServerId);
    this.logger.log(
      `Server ${serverSourceKey(input.pelicanServerId)} spawned Quick Play ${eventId}`,
    );
  }
}
