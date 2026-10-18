import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubJoinResponse } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PelicanPresenceSupervisor } from '../presence/pelican-presence.supervisor';
import {
  SERVER_PRESENCE_EVENTS,
  type ServerPresenceChangedPayload,
  type ServerRosterPlayer,
} from '../presence/server-presence.reader';
import {
  findVisibleServerHub,
  joinManual,
  leaveManual,
} from './server-hub-join.queries';
import {
  hubIdsForServers,
  refreshMemberCount,
  upsertSighting,
  usersBySteamId,
} from './server-hub-membership.queries';

/**
 * ROK-1831 — writes `hub_server_members`. Arrivals (presence CHANGED) record a
 * sighting and clear a Leave; the 10-minute touch keeps long sessions inside
 * the window (L-3) without undoing a Leave. Membership itself is computed at
 * read time (L-2) — nothing is ever deleted. Presence is read, never changed.
 */
@Injectable()
export class ServerHubMembershipService {
  private readonly logger = new Logger(ServerHubMembershipService.name);
  /** Last SteamIDs seen per server — tells an arrival from a stay. */
  private readonly rosters = new Map<number, Set<string>>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional()
    @Inject(PelicanPresenceSupervisor)
    private readonly presence: PelicanPresenceSupervisor | null = null,
  ) {}

  /**
   * A presence transition: upsert the sighting and (when `rejoin`) clear
   * `left_at`. `rejoin: false` is a "still online" touch. False when the
   * server has no hub.
   */
  async recordPresence(
    serverId: number,
    userId: number,
    characterName: string | null,
    at: Date,
    rejoin = true,
  ): Promise<boolean> {
    const guildId = (await hubIdsForServers(this.db, [serverId])).get(serverId);
    if (guildId === undefined) return false;
    await upsertSighting(
      this.db,
      { guildId, userId, characterName, at },
      rejoin,
    );
    await refreshMemberCount(this.db, guildId, at);
    return true;
  }

  /** The one call site on the presence pipeline: record each arrival. */
  @OnEvent(SERVER_PRESENCE_EVENTS.CHANGED)
  async onPresenceChanged(src: ServerPresenceChangedPayload): Promise<void> {
    try {
      await this.recordArrivals(src.pelicanServerId, new Date());
    } catch (err) {
      this.logger.error(
        `hub presence write failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** L-3 "still online" touch (cron, every 10 min). Returns sightings written. */
  async touchOnline(at: Date = new Date()): Promise<number> {
    const players = this.players();
    const hubs = await hubIdsForServers(this.db, [
      ...new Set(players.map((p) => p.pelicanServerId)),
    ]);
    const users = await usersBySteamId(
      this.db,
      players.filter((p) => hubs.has(p.pelicanServerId)).map((p) => p.steamId),
    );
    let written = 0;
    for (const p of players) {
      const guildId = hubs.get(p.pelicanServerId);
      const userId = users.get(p.steamId);
      if (guildId === undefined || userId === undefined) continue;
      await upsertSighting(
        this.db,
        { guildId, userId, characterName: p.name, at },
        false,
      );
      written += 1;
    }
    await this.refreshAllCounts(at);
    return written;
  }

  /** SteamIDs on this server right now (empty without the supervisor). */
  onlineSteamIds(serverId: number | null): Set<string> {
    if (serverId === null) return new Set();
    return new Set(
      this.players()
        .filter((p) => p.pelicanServerId === serverId)
        .map((p) => p.steamId),
    );
  }

  /** Manual Join (idempotent); 404 for a hidden or non-server hub. */
  async join(guildId: number, userId: number): Promise<HubJoinResponse> {
    await findVisibleServerHub(this.db, guildId);
    const now = new Date();
    await joinManual(this.db, guildId, userId, now);
    await refreshMemberCount(this.db, guildId, now);
    return { joined: true };
  }

  /** Manual Leave; the next arrival on the server re-adds them. */
  async leave(guildId: number, userId: number): Promise<HubJoinResponse> {
    await findVisibleServerHub(this.db, guildId);
    const now = new Date();
    await leaveManual(this.db, guildId, userId, now);
    await refreshMemberCount(this.db, guildId, now);
    return { joined: false };
  }

  private async recordArrivals(serverId: number, at: Date): Promise<void> {
    const players = this.players().filter(
      (p) => p.pelicanServerId === serverId,
    );
    const prev = this.rosters.get(serverId);
    this.rosters.set(serverId, new Set(players.map((p) => p.steamId)));
    // No baseline (first CHANGED since boot): everyone online is rehydrated,
    // not arriving — a touch that never clears a Leave (Codex r1 / review m1).
    const rejoin = prev !== undefined;
    const arrived = players.filter((p) => !prev?.has(p.steamId));
    if (arrived.length === 0) return;
    const users = await usersBySteamId(
      this.db,
      arrived.map((p) => p.steamId),
    );
    for (const p of arrived) {
      const userId = users.get(p.steamId);
      if (userId !== undefined)
        await this.recordPresence(serverId, userId, p.name, at, rejoin);
    }
  }

  private players(): ServerRosterPlayer[] {
    return this.presence?.playersOnGames() ?? [];
  }

  private async refreshAllCounts(at: Date): Promise<void> {
    const g = schema.guilds;
    const hubs = await this.db
      .select({ id: g.id })
      .from(g)
      .where(eq(g.kind, 'game_server'));
    for (const h of hubs) await refreshMemberCount(this.db, h.id, at);
  }
}
