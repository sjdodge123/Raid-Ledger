/**
 * ROK-1953 §4.4 — pure helpers for the read route: a member's status (D6:
 * `steam_id IS NULL` = `unlinked`, no stats row = `pending`) and the
 * `members[]` order.
 */
import type {
  SteamHubMemberStats,
  SteamStatsStatus,
} from '@raid-ledger/contract';

/** A member's stored `steam_user_app_stats` row for the hub's app. */
export interface StoredMemberStats {
  status: SteamStatsStatus;
  unlockedCount: number | null;
  fetchedAt: Date;
}

/** Everything the read path knows about one live member. */
export interface MemberInput {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  steamId: string | null;
  stats: StoredMemberStats | undefined;
  playtimeMinutes: number | null;
}

/** D6: unlink keeps the rows but the member reads as `unlinked`. */
export function memberStatus(
  steamId: string | null,
  stats: StoredMemberStats | undefined,
): SteamStatsStatus {
  if (steamId === null) return 'unlinked';
  return stats?.status ?? 'pending';
}

/**
 * The wire row. `unlockedCount` is null unless `ok`; an unlinked member
 * shows no Steam-derived numbers at all (playtime included).
 */
export function toMemberStats(m: MemberInput): SteamHubMemberStats {
  const status = memberStatus(m.steamId, m.stats);
  const linked = status !== 'unlinked';
  return {
    userId: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    status,
    unlockedCount: status === 'ok' ? (m.stats?.unlockedCount ?? 0) : null,
    playtimeMinutes: linked ? m.playtimeMinutes : null,
    fetchedAt: linked && m.stats ? m.stats.fetchedAt.toISOString() : null,
  };
}

/** `unlockedCount` desc, nulls last, then display name (contract order). */
export function sortMembers(
  members: readonly SteamHubMemberStats[],
): SteamHubMemberStats[] {
  return [...members].sort((a, b) => {
    const ca = a.unlockedCount ?? -1;
    const cb = b.unlockedCount ?? -1;
    if (ca !== cb) return cb - ca;
    return a.displayName.localeCompare(b.displayName);
  });
}
