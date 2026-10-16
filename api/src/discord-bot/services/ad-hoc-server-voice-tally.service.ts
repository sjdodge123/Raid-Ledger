/**
 * ROK-1801 layer D (operator ruling Q9) — the server-triggered spawn's
 * threshold also counts voice. `countFor` returns how many people sit in the
 * game's monitor-bound voice channels and count for that game (rich presence
 * on it, or none — the voice path's own rule), minus anyone already held on
 * the server, so each person counts once.
 *
 * Resolved lazily through `ModuleRef` so this provider can live in the
 * global `AdHocServerPresenceModule` without touching `DiscordBotModule`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildMember } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { ServerPresenceSource } from '../../plugins/pelican/presence/server-presence.sink';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { humanMembers } from '../listeners/voice-lobby-groups.helpers';
import { resolveVoiceChannel } from '../listeners/voice-state.helpers';
import type { PendingServerPlayers } from './ad-hoc-server-pending';
import { PresenceGameDetectorService } from './presence-game-detector.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Voice channels carrying a game-voice-monitor binding for `gameId`. */
async function monitorChannelIds(db: Db, gameId: number): Promise<string[]> {
  const cb = schema.channelBindings;
  const rows = await db
    .select({ channelId: cb.channelId })
    .from(cb)
    .where(
      and(eq(cb.gameId, gameId), eq(cb.bindingPurpose, 'game-voice-monitor')),
    );
  return [...new Set(rows.map((r) => r.channelId))];
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
    .where(inArray(schema.users.steamId, steamIds));
  return new Set(rows.flatMap((r) => (r.discordId ? [r.discordId] : [])));
}

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
  ): Promise<number> {
    const channelIds = await monitorChannelIds(this.db, source.gameId);
    if (channelIds.length === 0) return 0;
    const held = pending.players(source.pelicanServerId).map((p) => p.steamId);
    const exclude = await linkedDiscordIds(this.db, held);
    const counted = new Set<string>();
    for (const member of this.voiceMembers(channelIds)) {
      if (exclude.has(member.id) || counted.has(member.id)) continue;
      if (await this.countsFor(member, source.gameId)) counted.add(member.id);
    }
    return counted.size;
  }

  /** Human members of every resolvable channel in `channelIds`. */
  private voiceMembers(channelIds: string[]): GuildMember[] {
    const client = this.moduleRef.get(DiscordBotClientService, {
      strict: false,
    });
    return channelIds.flatMap((id) => {
      const channel = resolveVoiceChannel(client, id);
      return channel ? humanMembers(channel) : [];
    });
  }

  /** The voice path's rule: on this game, or no rich presence at all. */
  private async countsFor(
    member: GuildMember,
    gameId: number,
  ): Promise<boolean> {
    const detector = this.moduleRef.get(PresenceGameDetectorService, {
      strict: false,
    });
    const detected = await detector.detectGameForMember(member);
    return detected.gameId === null || detected.gameId === gameId;
  }
}
