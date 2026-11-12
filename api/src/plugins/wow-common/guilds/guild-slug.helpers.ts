/**
 * ROK-1928 A — pure helpers for the Forever guild's Blizzard roster slug.
 */
import type { GuildSummary } from '@raid-ledger/contract';
import type { GuildSelect } from '../../../drizzle/schema/guilds';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';

/**
 * Suggest a Blizzard guild slug from the in-game name (FLAG A-1): lowercase,
 * trimmed, apostrophes dropped, whitespace runs → `-`, then anything but a
 * letter, digit or `-` dropped so it always fits `BLIZZARD_GUILD_SLUG_PATTERN`
 * (punctuation like `.`, `,`, `&` would fail it). Only a prefill — the
 * officer confirms it; the sync never derives a slug on its own.
 */
export function slugifyGuildName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/** The guild columns `blizzardRosterFor` reads. */
export type BlizzardRosterRow = Pick<
  GuildSelect,
  'kind' | 'guildSlug' | 'blizzardRosterStatus' | 'blizzardRosterSyncedAt'
>;

/**
 * `GuildSummary.blizzardRoster` as a spreadable fragment — present only on a
 * WoW: Forever `wow_guild` hub, empty for every other hub.
 */
export function blizzardRosterFor(
  row: BlizzardRosterRow,
  gameSlug: string | null,
): Pick<GuildSummary, 'blizzardRoster'> {
  if (!isForeverGuildHub(row.kind, gameSlug)) return {};
  return {
    blizzardRoster: {
      guildSlug: row.guildSlug,
      status: row.blizzardRosterStatus,
      syncedAt: row.blizzardRosterSyncedAt?.toISOString() ?? null,
    },
  };
}

/** The guild columns `blizzardGuildFor` reads. */
export type BlizzardGuildRow = Pick<
  GuildSelect,
  'kind' | 'foundedAt' | 'blizzardSummaryStatus'
>;

/**
 * ROK-1170 — `GuildSummary.blizzardGuild` (founded date + summary state) as a
 * spreadable fragment; present only on a WoW: Forever `wow_guild` hub.
 */
export function blizzardGuildFor(
  row: BlizzardGuildRow,
  gameSlug: string | null,
): Pick<GuildSummary, 'blizzardGuild'> {
  if (!isForeverGuildHub(row.kind, gameSlug)) return {};
  return {
    blizzardGuild: {
      foundedAt: row.foundedAt?.toISOString() ?? null,
      state: row.blizzardSummaryStatus,
    },
  };
}

/** True when the hub is a WoW: Forever `wow_guild` (the roster sync's scope). */
export function isForeverGuildHub(
  kind: GuildSelect['kind'],
  gameSlug: string | null,
): boolean {
  return kind === 'wow_guild' && gameSlug === WOW_FOREVER_GAME_SLUG;
}
