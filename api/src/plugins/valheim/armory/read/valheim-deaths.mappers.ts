/**
 * ROK-1930 L2 — fold stored death buckets into the Deaths widget's bars.
 * D7: a bar per SteamID; a NULL-steam bucket takes the SteamID of the ONE
 * profile on the server with that character name, otherwise it stays a
 * name-only bar (no link). D9: `characterId` = the player's newest profile.
 */
import type {
  ValheimDeathPlayer,
  ValheimDeathsResponse,
} from '@raid-ledger/contract';
import type {
  DeathCounts,
  DeathGroupRow,
  DeathProfileRow,
} from '../valheim-deaths.repository';

/** The contract's cap on bars (the widget shows fewer). */
export const MAX_DEATH_PLAYERS = 200;
const NAME_MAX = 64;

interface Bar {
  steamId: string | null;
  name: string;
  deaths: number;
  last: Date;
}

/** D7: the bucket's SteamID, or the single same-name profile's. */
export function resolveSteamId(
  group: Pick<DeathGroupRow, 'steamId' | 'characterName'>,
  profiles: DeathProfileRow[],
): string | null {
  if (group.steamId !== null) return group.steamId;
  const named = profiles.filter((p) => p.name === group.characterName);
  const only = named.length === 1 ? named[0] : undefined;
  return only?.steamId ?? null;
}

/** D9: the newest profile (by `captured_at`) for a SteamID, or null. */
export function latestCharacterId(
  steamId: string | null,
  profiles: DeathProfileRow[],
): number | null {
  if (steamId === null) return null;
  let best: DeathProfileRow | undefined;
  for (const p of profiles) {
    if (p.steamId !== steamId) continue;
    if (!best || p.capturedAt > best.capturedAt) best = p;
  }
  return best?.id ?? null;
}

function mergeBars(counts: DeathCounts): Bar[] {
  const bars = new Map<string, Bar>();
  for (const g of counts.groups) {
    if (g.lastDeathAt === null || g.deaths < 1) continue;
    const steamId = resolveSteamId(g, counts.profiles);
    const key = steamId ?? `name:${g.characterName}`;
    const prev = bars.get(key);
    if (!prev) {
      bars.set(key, {
        steamId,
        name: g.characterName,
        deaths: g.deaths,
        last: g.lastDeathAt,
      });
      continue;
    }
    prev.deaths += g.deaths;
    if (g.lastDeathAt > prev.last) {
      prev.last = g.lastDeathAt;
      prev.name = g.characterName;
    }
  }
  return [...bars.values()];
}

/** Deaths desc, then lastDeathAt desc, then name asc (stable, locale-free). */
export function compareBars(
  a: Pick<Bar, 'deaths' | 'last' | 'name'>,
  b: Pick<Bar, 'deaths' | 'last' | 'name'>,
): number {
  if (a.deaths !== b.deaths) return b.deaths - a.deaths;
  const t = b.last.getTime() - a.last.getTime();
  if (t !== 0) return t;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function earliest(groups: DeathGroupRow[]): string | null {
  const times = groups.flatMap((g) =>
    g.firstDeathAt === null ? [] : [g.firstDeathAt.getTime()],
  );
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

/** The `GET …/servers/:serverId/deaths` body. */
export function toDeathsResponse(counts: DeathCounts): ValheimDeathsResponse {
  const players: ValheimDeathPlayer[] = mergeBars(counts)
    .sort(compareBars)
    .slice(0, MAX_DEATH_PLAYERS)
    .map((b) => ({
      steamId: b.steamId,
      name: b.name.slice(0, NAME_MAX),
      deaths: b.deaths,
      lastDeathAt: b.last.toISOString(),
      characterId: latestCharacterId(b.steamId, counts.profiles),
    }));
  return { players, since: earliest(counts.groups) };
}
