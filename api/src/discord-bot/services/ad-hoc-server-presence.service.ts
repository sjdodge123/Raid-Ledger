import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { startGracePeriod } from './ad-hoc-event.handlers';
import {
  findAdminFallback,
  getEventById,
  resolveGameName,
  restoreFromGracePeriod,
} from './ad-hoc-event.helpers';
import { AD_HOC_EVENTS } from '../discord-bot.constants';
import {
  spawnOrFindServerQuickPlay,
  spawnRoster,
  type ServerSpawnInput,
} from './ad-hoc-server-spawn.helpers';
import {
  DEFAULT_SERVER_MIN_PLAYERS,
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
  listOpenServerPresence,
  listOnServerSteamIds,
  renameSteamOnlyRow,
  resolveSteamIdentity,
  serverSourceKey,
  type GameQuickPlayBinding,
  type LiveGameEvent,
  type SteamIdentity,
} from './ad-hoc-server-presence.helpers';

interface SpawnPlan {
  source: ServerPresenceSource;
  binding: GameQuickPlayBinding | null;
  players: ServerPresencePlayer[];
}

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
  private readonly pending = new Map<
    number,
    Map<string, ServerPresencePlayer>
  >();
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
      const held = this.pending.get(source.pelicanServerId);
      if (held?.has(player.steamId)) held.set(player.steamId, player);
      const live = await findLiveGameAdHocEvent(this.db, source.gameId);
      if (!live) return;
      await renameSteamOnlyRow(this.db, live.id, player);
      await this.refresh(live);
    });
  }

  playerLeft(source: ServerPresenceSource, steamId: string): Promise<void> {
    return this.serial(source.gameId, async () => {
      this.pending.get(source.pelicanServerId)?.delete(steamId);
      const live = await findLiveGameAdHocEvent(this.db, source.gameId);
      if (!live) return;
      if (await this.participantService.markServerLeave(live.id, steamId))
        await this.afterLeave(live);
    });
  }

  serverEmptied(source: ServerPresenceSource): Promise<void> {
    return this.serial(source.gameId, async () => {
      this.pending.delete(source.pelicanServerId);
      const live = await findLiveGameAdHocEvent(this.db, source.gameId);
      if (!live) return;
      const open = await listOnServerSteamIds(
        this.db,
        live.id,
        source.pelicanServerId,
      );
      for (const steamId of open)
        await this.participantService.markServerLeave(live.id, steamId);
      if (open.length > 0) await this.afterLeave(live);
    });
  }

  async openPresence(
    source: ServerPresenceSource,
  ): Promise<ServerPresencePlayer[]> {
    const live = await findLiveGameAdHocEvent(this.db, source.gameId);
    return live
      ? listOpenServerPresence(this.db, live.id, source.pelicanServerId)
      : [];
  }

  // ─── Private ──────────────────────────────────────────

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
    const all = new Map(this.pending.get(source.pelicanServerId));
    for (const pl of players) all.set(pl.steamId, pl);
    this.pending.delete(source.pelicanServerId);
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
    await this.refresh(live);
  }

  /** Below threshold: hold the player; at threshold: guard, then spawn. */
  private async joinPending(
    source: ServerPresenceSource,
    player: ServerPresencePlayer,
  ): Promise<void> {
    const players =
      this.pending.get(source.pelicanServerId) ??
      new Map<string, ServerPresencePlayer>();
    players.set(player.steamId, player);
    this.pending.set(source.pelicanServerId, players);
    const binding = await findGameVoiceBinding(this.db, source.gameId);
    const min = binding?.config?.minPlayers ?? DEFAULT_SERVER_MIN_PLAYERS;
    if (players.size < min) return;
    const clearance = await checkSuppression(
      this.db,
      serverSourceKey(source.pelicanServerId),
      source.gameId,
      undefined,
      this.onWindowExtended,
    );
    if (!clearance) return;
    const plan = { source, binding, players: [...players.values()] };
    if (await this.spawn(plan, clearance))
      this.pending.delete(source.pelicanServerId);
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
    await this.announce(eventId, plan, input.ids);
    this.logger.log(
      `Server ${serverSourceKey(input.pelicanServerId)} spawned Quick Play ${eventId}`,
    );
  }

  /** The bound game's Quick Play channel when one exists, else web only. */
  private async announce(
    eventId: number,
    plan: SpawnPlan,
    ids: (SteamIdentity | null)[],
  ): Promise<void> {
    const { binding, players, source } = plan;
    if (binding) {
      const event = await getEventById(this.db, eventId);
      const gameName = await resolveGameName(this.db, source.gameId);
      await this.notificationService.notifySpawn(
        eventId,
        binding.id,
        {
          id: eventId,
          title: event?.title ?? 'Quick Play',
          ...(gameName !== undefined ? { gameName } : {}),
        },
        spawnRoster(players, ids),
        source.gameId,
      );
    }
    this.gateway.emitStatusChange(eventId, 'live');
    await this.emitRoster(eventId);
  }

  /** After a server leave: refresh, then start grace once nobody is left. */
  private async afterLeave(live: LiveGameEvent): Promise<void> {
    await this.refresh(live);
    if (live.adHocStatus !== 'live') return;
    if ((await this.participantService.getActiveCount(live.id)) > 0) return;
    await startGracePeriod(
      {
        db: this.db,
        channelBindingsService: this.channelBindingsService,
        gracePeriodQueue: this.gracePeriodQueue,
        gateway: this.gateway,
      },
      live.id,
      live.channelBindingId,
    );
  }

  private async refresh(live: LiveGameEvent): Promise<void> {
    if (live.channelBindingId)
      this.notificationService.queueUpdate(live.id, live.channelBindingId);
    await this.emitRoster(live.id);
  }

  private async emitRoster(eventId: number): Promise<void> {
    const roster = await this.adHocEventService.getAdHocRoster(eventId);
    this.gateway.emitRosterUpdate(
      eventId,
      roster.participants,
      roster.activeCount,
    );
  }
}
