/**
 * ROK-2187 — admin dry run: what a compute + DM wave would do for `year`,
 * computed live (nothing stored). Skip reasons: deactivated, opted out of
 * `gg_ready` in-app, no Discord (in-app only, Q6), no activity (R4).
 */
import type { GgAdminDryRunDto, GgSnapshotV1 } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { userNotificationPreferences, users } from '../../../drizzle/schema';

/** The per-user facts a dry run needs. */
export interface GgUserFacet {
  id: number;
  deactivated: boolean;
  hasDiscord: boolean;
  optedOut: boolean;
}

/** Every user with their deactivation, Discord link and `gg_ready` pref. */
export async function loadGgUserFacets(
  db: PostgresJsDatabase<typeof schema>,
): Promise<GgUserFacet[]> {
  const rows = await db
    .select({
      id: users.id,
      deactivatedAt: users.deactivatedAt,
      discordId: users.discordId,
      prefs: userNotificationPreferences.channelPrefs,
    })
    .from(users)
    .leftJoin(
      userNotificationPreferences,
      eq(userNotificationPreferences.userId, users.id),
    );
  return rows.map((r) => ({
    id: r.id,
    deactivated: r.deactivatedAt !== null,
    hasDiscord: r.discordId !== null,
    optedOut: r.prefs?.gg_ready?.inApp === false,
  }));
}

/** Tally the dry run from facets + a live per-user compute. */
export async function tallyGgDryRun(
  facets: readonly GgUserFacet[],
  computeFor: (userId: number) => Promise<GgSnapshotV1 | null>,
  year: number,
  announcedAt: Date | null,
): Promise<GgAdminDryRunDto> {
  const dto: GgAdminDryRunDto = {
    year,
    usersComputed: 0,
    short: 0,
    full: 0,
    wouldDm: 0,
    announcedAt: announcedAt?.toISOString() ?? null,
    skipped: { deactivated: 0, optedOut: 0, noDiscord: 0, noActivity: 0 },
  };
  for (const user of facets) {
    if (user.deactivated) {
      dto.skipped.deactivated += 1;
      continue;
    }
    const snapshot = await computeFor(user.id);
    if (snapshot === null) {
      dto.skipped.noActivity += 1;
      continue;
    }
    dto.usersComputed += 1;
    dto[snapshot.tier] += 1;
    if (user.optedOut) dto.skipped.optedOut += 1;
    else if (!user.hasDiscord) dto.skipped.noDiscord += 1;
    else dto.wouldDm += 1;
  }
  return dto;
}
