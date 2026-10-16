/**
 * ROK-1801 layer D (operator ruling Q9) — the server-triggered spawn's
 * threshold also counts voice. `countFor` returns how many people sit in the
 * game's monitor-bound voice channels and count for that game (rich presence
 * on it, or none — the voice path's own rule), minus anyone already held on
 * the server, so each person counts once. `unconfirmed` is how many of them
 * count only through a missing rich presence (Codex r3 P2): the voice path
 * gives such a tally the delayed spawn, never the immediate one.
 *
 * Review fixes (2026-10-16): the count uses main's `countsTowardThreshold`
 * (ROK-1711 bot rule + DEMO allowlist); a monitor channel that also carries a
 * general-lobby binding is skipped (the lobby wins — ROK-1782 ruling (a)); a
 * member on ANOTHER game's server belongs to that game (Q3), whatever their
 * rich presence says; deactivated users are not linked. Any lookup failure
 * returns 0 so the held player's threshold check never rejects.
 *
 * Resolved lazily through `ModuleRef` so this provider can live in the
 * global `AdHocServerPresenceModule` without touching `DiscordBotModule`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildMember } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { ServerPresenceSource } from '../../plugins/pelican/presence/server-presence.sink';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { countsTowardThreshold } from '../listeners/voice-threshold-count.helpers';
import { serverGameOf } from '../listeners/voice-lobby-server-merge.helpers';
import { resolveVoiceChannel } from '../listeners/voice-state.helpers';
import type { PendingServerPlayers } from './ad-hoc-server-pending';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { ServerPresenceRosterService } from './server-presence-roster.service';
import type { ServerRoster } from './server-presence-roster.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Voice channels carrying a game-voice-monitor binding for `gameId`, minus
 * any channel a general-lobby binding outranks (ROK-1782 ruling (a)).
 */
async function monitorChannelIds(db: Db, gameId: number): Promise<string[]> {
  const cb = schema.channelBindings;
  const rows = await db
    .select({ channelId: cb.channelId })
    .from(cb)
    .where(
      and(eq(cb.gameId, gameId), eq(cb.bindingPurpose, 'game-voice-monitor')),
    );
  const ids = [...new Set(rows.map((r) => r.channelId))];
  if (ids.length === 0) return [];
  const lobbies = await db
    .select({ channelId: cb.channelId })
    .from(cb)
    .where(
      and(inArray(cb.channelId, ids), eq(cb.bindingPurpose, 'general-lobby')),
    );
  const outranked = new Set(lobbies.map((r) => r.channelId));
  return ids.filter((id) => !outranked.has(id));
}

/** Discord ids of the RL users linked to these SteamID64s. */
async function linkedDiscordIds(
  db: Db,
  steamIds: string[],
): Promise<Set<string>> {
  if (steamIds.length === 0) return new Set();
  const rows = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(
      and(
        inArray(schema.users.steamId, steamIds),
        isNull(schema.users.deactivatedAt),
      ),
    );
  return new Set(rows.flatMap((r) => (r.discordId ? [r.discordId] : [])));
}

/** Voice people for a game; `unconfirmed` of them have no rich presence. */
export interface ServerPathVoiceCount {
  counted: number;
  unconfirmed: number;
}

const NO_VOICE: ServerPathVoiceCount = { counted: 0, unconfirmed: 0 };

@Injectable()
export class ServerPathVoiceTally {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Voice people for `source.gameId`, excluding the server's held players. */
  async countFor(
    source: ServerPresenceSource,
    pending: PendingServerPlayers,
  ): Promise<ServerPathVoiceCount> {
    try {
      return await this.tally(source, pending);
    } catch {
      return NO_VOICE; // review MINOR 6: never reject the sink's serial step.
    }
  }

  private async tally(
    source: ServerPresenceSource,
    pending: PendingServerPlayers,
  ): Promise<ServerPathVoiceCount> {
    const channelIds = await monitorChannelIds(this.db, source.gameId);
    if (channelIds.length === 0) return NO_VOICE;
    const held = pending.players(source.pelicanServerId).map((p) => p.steamId);
    const exclude = await linkedDiscordIds(this.db, held);
    const roster = await this.roster();
    const counted = new Map<string, boolean>(); // id -> confirmed
    for (const member of this.voiceMembers(channelIds)) {
      if (exclude.has(member.id) || counted.has(member.id)) continue;
      const serverGame = roster ? serverGameOf(roster, member.id) : null;
      if (serverGame !== null) {
        if (serverGame === source.gameId) counted.set(member.id, true);
        continue; // Q3: the server beats rich presence either way.
      }
      const detected = await this.detectedGame(member);
      if (detected === null || detected === source.gameId)
        counted.set(member.id, detected !== null);
    }
    const confirmed = [...counted.values()].filter(Boolean).length;
    return { counted: counted.size, unconfirmed: counted.size - confirmed };
  }

  /** The live server roster, or null when the provider is unavailable. */
  private async roster(): Promise<ServerRoster | null> {
    try {
      const svc = this.moduleRef.get(ServerPresenceRosterService, {
        strict: false,
      });
      return await svc.snapshot();
    } catch {
      return null;
    }
  }

  /** Threshold-counting members (ROK-1711 rule) of every resolvable channel. */
  private voiceMembers(channelIds: string[]): GuildMember[] {
    const client = this.moduleRef.get(DiscordBotClientService, {
      strict: false,
    });
    return channelIds.flatMap((id) => {
      const channel = resolveVoiceChannel(client, id);
      if (!channel) return [];
      return [...channel.members.values()].filter((m) =>
        countsTowardThreshold(m),
      );
    });
  }

  /**
   * The member's rich-presence game. The voice path's rule: on this game
   * (confirmed), or none at all (counts, unconfirmed).
   */
  private async detectedGame(member: GuildMember): Promise<number | null> {
    const detector = this.moduleRef.get(PresenceGameDetectorService, {
      strict: false,
    });
    return (await detector.detectGameForMember(member)).gameId;
  }
}
