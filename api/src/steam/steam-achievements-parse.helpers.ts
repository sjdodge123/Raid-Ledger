/**
 * ROK-1953 — pure parsers for Steam ISteamUserStats bodies. Steam's shapes are
 * UNVERIFIED against a live capture (see testing/steam-achievements.fixtures.ts),
 * so every read narrows `unknown` and drops what it does not recognise.
 */

/** An achievement the player has earned. `unlockedAt` is null when Steam reports time 0. */
export interface SteamUnlockedAchievement {
  apiName: string;
  unlockedAt: Date | null;
}

/** One achievement from GetSchemaForGame (English). */
export interface SteamSchemaAchievement {
  apiName: string;
  name: string;
  description: string | null;
  icon: string | null;
  hidden: boolean;
}

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function nonBlank(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Parse a body as JSON, or `undefined` for HTML / empty / malformed text. */
export function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `playerstats` of a GetPlayerAchievements body, if present. */
export function playerStatsOf(body: unknown): Obj | undefined {
  return asObj(asObj(body)?.playerstats);
}

/** Achieved (`achieved === 1`) entries of a successful `playerstats`. */
export function parseUnlocked(stats: Obj): SteamUnlockedAchievement[] {
  return asArray(stats.achievements).flatMap((raw) => {
    const a = asObj(raw);
    if (a?.achieved !== 1 || typeof a.apiname !== 'string') return [];
    const secs = typeof a.unlocktime === 'number' ? a.unlocktime : 0;
    return [
      {
        apiName: a.apiname,
        unlockedAt: secs > 0 ? new Date(secs * 1000) : null,
      },
    ];
  });
}

/**
 * Achievements of a GetSchemaForGame body. An entry with no `hidden` field
 * fails closed — treated as hidden so it stays masked — and is counted in
 * `missingHidden` so the caller can log it (OQ5: never infer it is visible).
 */
export function parseSchema(body: unknown): {
  achievements: SteamSchemaAchievement[];
  missingHidden: number;
} {
  const stats = asObj(asObj(asObj(body)?.game)?.availableGameStats);
  let missingHidden = 0;
  const achievements = asArray(stats?.achievements).flatMap((raw) => {
    const a = asObj(raw);
    if (typeof a?.name !== 'string') return [];
    if (a.hidden === undefined) missingHidden += 1;
    return [
      {
        apiName: a.name,
        name: nonBlank(a.displayName) ?? a.name,
        description: nonBlank(a.description),
        icon: nonBlank(a.icon),
        hidden:
          a.hidden === undefined ? true : a.hidden === 1 || a.hidden === true,
      },
    ];
  });
  return { achievements, missingHidden };
}

/** apiName → global unlock % (0–100) from GetGlobalAchievementPercentagesForApp. */
export function parsePercentages(body: unknown): Map<string, number> {
  const list = asObj(asObj(body)?.achievementpercentages)?.achievements;
  const out = new Map<string, number>();
  for (const raw of asArray(list)) {
    const a = asObj(raw);
    const pct = typeof a?.percent === 'string' ? Number(a.percent) : a?.percent;
    if (
      typeof a?.name !== 'string' ||
      typeof pct !== 'number' ||
      !Number.isFinite(pct)
    )
      continue;
    out.set(a.name, Math.min(100, Math.max(0, pct)));
  }
  return out;
}
