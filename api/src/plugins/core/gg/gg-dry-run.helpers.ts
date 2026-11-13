/**
 * ROK-2187 — admin dry run: what a compute + DM wave would do for `year`,
 * computed live (nothing stored). Buckets come from `ggRecipientBucket`, the
 * same predicate delivery follows: deactivated, opted out of `gg_ready`
 * in-app or Discord, no real Discord id (in-app only, Q6), no activity (R4).
 */
import type { GgAdminDryRunDto, GgSnapshotV1 } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { userNotificationPreferences, users } from '../../../drizzle/schema';
import {
  ggRecipientBucket,
  type GgRecipientBucket,
} from './gg-eligibility.helpers';

/** One user and the delivery bucket they land in (shared predicate). */
export interface GgUserFacet {
  id: number;
  bucket: GgRecipientBucket;
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
    bucket: ggRecipientBucket({
      deactivatedAt: r.deactivatedAt,
      discordId: r.discordId,
      prefs: r.prefs,
    }),
  }));
}

/** All-zero dry run for `year`. */
function emptyGgDryRun(
  year: number,
  announcedAt: Date | null,
): GgAdminDryRunDto {
  return {
    year,
    usersComputed: 0,
    short: 0,
    full: 0,
    wouldDm: 0,
    announcedAt: announcedAt?.toISOString() ?? null,
    skipped: { deactivated: 0, optedOut: 0, noDiscord: 0, noActivity: 0 },
  };
}

/** Tally the dry run from facets + a live per-user compute. */
export async function tallyGgDryRun(
  facets: readonly GgUserFacet[],
  computeFor: (userId: number) => Promise<GgSnapshotV1 | null>,
  year: number,
  announcedAt: Date | null,
): Promise<GgAdminDryRunDto> {
  const dto = emptyGgDryRun(year, announcedAt);
  for (const user of facets) {
    if (user.bucket === 'deactivated') {
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
    if (user.bucket === 'dm') dto.wouldDm += 1;
    else dto.skipped[user.bucket] += 1;
  }
  return dto;
}
