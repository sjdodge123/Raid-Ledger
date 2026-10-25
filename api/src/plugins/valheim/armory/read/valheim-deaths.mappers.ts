/**
 * ROK-1930 L2 — fold stored death buckets into the Deaths widget's bars.
 * D7: a bar per SteamID; a NULL-steam bucket takes the SteamID of the ONE
 * profile on the server with that character name, otherwise it stays a
 * name-only bar (no link). D9: `characterId` = the player's newest profile.
 * D13: SteamIDs group bars here and never leave — each bar carries an
 * opaque `key` instead.
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
import {
  foldPictures,
  type BarPictures,
  type DeathPictureBucket,
} from './valheim-deaths-pictures.mappers';

/** The contract's cap on bars (the widget shows fewer). */
export const MAX_DEATH_PLAYERS = 200;
const NAME_MAX = 64;
/** A blank stored name would fail the contract's `name.min(1)` and 500 the read. */
export const UNKNOWN_CHARACTER = 'Unknown character';

const displayName = (raw: string): string =>
  (raw.trim() === '' ? UNKNOWN_CHARACTER : raw).slice(0, NAME_MAX);

interface Bar {
  /** D7 merge key: the SteamID, else `name:<character name>`. */
  mergeKey: string;
  steamId: string | null;
  name: string;
  deaths: number;
  first: number;
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

/** D7: the bar a `(steam_id, character_name)` bucket folds into. */
export function barMergeKey(
  group: Pick<DeathGroupRow, 'steamId' | 'characterName'>,
  profiles: DeathProfileRow[],
): string {
  return resolveSteamId(group, profiles) ?? `name:${group.characterName}`;
}

function mergeBars(counts: DeathCounts): Bar[] {
  const bars = new Map<string, Bar>();
  for (const g of counts.groups) {
    if (g.lastDeathAt === null || g.deaths < 1) continue;
    const steamId = resolveSteamId(g, counts.profiles);
    const key = barMergeKey(g, counts.profiles);
    const prev = bars.get(key);
    if (!prev) {
      bars.set(key, {
        mergeKey: key,
        steamId,
        name: g.characterName,
        deaths: g.deaths,
        first: g.firstDeathAt?.getTime() ?? g.lastDeathAt.getTime(),
        last: g.lastDeathAt,
      });
      continue;
    }
    prev.deaths += g.deaths;
    prev.first = Math.min(prev.first, g.firstDeathAt?.getTime() ?? prev.first);
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

interface KeyedBar extends Bar {
  key: string;
  characterId: number | null;
}

/** Earliest first death, then SteamID, then name: a total order on bars. */
const byFirstDeath = (a: KeyedBar, b: KeyedBar): number =>
  a.first - b.first ||
  (a.steamId ?? '').localeCompare(b.steamId ?? '') ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * D13: `c<characterId>`, else `n<name>`. Two unlinked bars can share a name
 * (an unprofiled SteamID and a name-only bucket); in first-death order a
 * taken key gets the lowest free `~2`, `~3`… Checking against every key
 * already handed out keeps keys unique even when a real name is `Sam~2`,
 * and the order ignores counts, so keys hold as deaths are added.
 */
function withKeys(bars: Bar[], profiles: DeathProfileRow[]): KeyedBar[] {
  const keyed = bars.map((b) => {
    const characterId = latestCharacterId(b.steamId, profiles);
    const name = displayName(b.name);
    const key = characterId === null ? `n${name}` : `c${characterId}`;
    return { ...b, name, key, characterId };
  });
  const taken = new Set<string>();
  for (const b of [...keyed].sort(byFirstDeath)) {
    let key = b.key;
    for (let n = 2; taken.has(key); n += 1) key = `${b.key}~${n}`;
    taken.add(key);
    b.key = key;
  }
  return keyed;
}

const toPlayer = (
  b: KeyedBar,
  pics: BarPictures | undefined,
): ValheimDeathPlayer => ({
  key: b.key,
  name: b.name,
  deaths: b.deaths,
  lastDeathAt: b.last.toISOString(),
  characterId: b.characterId,
  ...(pics ?? {}),
});

/**
 * The `GET …/servers/:serverId/deaths` body. ROK-1941 D13: `pictures`
 * (visible death pictures per bucket) fold through the same D7 merge key;
 * a bar with none carries neither `pictures` nor `pictureCount`.
 */
export function toDeathsResponse(
  counts: DeathCounts,
  pictures: DeathPictureBucket[] = [],
): ValheimDeathsResponse {
  const byBar = foldPictures(pictures, (b) => barMergeKey(b, counts.profiles));
  const players = withKeys(mergeBars(counts), counts.profiles)
    .sort(compareBars)
    .slice(0, MAX_DEATH_PLAYERS)
    .map((b) => toPlayer(b, byBar.get(b.mergeKey)));
  return { players, since: earliest(counts.groups) };
}
