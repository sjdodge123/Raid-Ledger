/**
 * ROK-2187 — stored `gg_snapshots` rows → wire DTOs. The public projection
 * is an allow-list parsed through the strict contract schema (Q4): only the
 * Summary card's numbers, a count of people (never names), no ids, no email.
 */
import {
  CORE_PLUGIN_ID,
  GgPublicSummaryDtoSchema,
  GgSummaryCardSchema,
  parseGgSnapshot,
  type GgArchiveDto,
  type GgOwnerSnapshotDto,
  type GgPublicSummaryDto,
  type GgShareStateDto,
} from '@raid-ledger/contract';
import { publicAvatarUrl } from '../../../common/public-avatar-url.helpers';
import type { GgSnapshotRow } from '../../../drizzle/schema/gg-snapshots';
import type {
  GgArchiveRow,
  GgPublicRow,
  GgShareRow,
} from './gg-snapshot.queries';

/** Share columns → share state. */
export function toGgShareState(row: GgShareRow): GgShareStateDto {
  return {
    shared: row.shareSlug !== null,
    slug: row.shareSlug,
    sharedAt: row.sharedAt ? row.sharedAt.toISOString() : null,
  };
}

/** The owner's frozen snapshot exactly as stored (AC1). */
export function toGgOwnerDto(
  row: GgSnapshotRow,
  archiveYears: number[],
): GgOwnerSnapshotDto {
  const snapshot = parseGgSnapshot(row.payload);
  return {
    year: row.year,
    tier: row.activityTier,
    computedAt: row.computedAt.toISOString(),
    cards: snapshot.cards,
    share: toGgShareState(row),
    archiveYears,
  };
}

/** Archive rows → `GET /gg/archive`. */
export function toGgArchiveDto(rows: GgArchiveRow[]): GgArchiveDto {
  return {
    years: rows.map((r) => ({
      year: r.year,
      tier: r.activityTier,
      computedAt: r.computedAt.toISOString(),
      shared: r.shareSlug !== null,
    })),
  };
}

/**
 * The public Summary (Q4), or `null` when the snapshot has no summary card.
 * Strict-parsed so a field leak fails loudly instead of reaching the wire.
 */
export function toGgPublicSummary(row: GgPublicRow): GgPublicSummaryDto | null {
  const snapshot = parseGgSnapshot(row.payload);
  const card = snapshot.cards.find(
    (c) => c.pluginSlug === CORE_PLUGIN_ID && c.cardId === 'summary',
  );
  if (!card) return null;
  const summary = GgSummaryCardSchema.parse(card.payload);
  return GgPublicSummaryDtoSchema.parse({
    year: row.year,
    displayName: row.displayName ?? row.username,
    avatarUrl: row.customAvatarUrl ?? publicAvatarUrl(row.avatar),
    eventsAttended: summary.eventsAttended,
    hoursPlayedSeconds: summary.hoursPlayedSeconds,
    topGames: summary.topGames.map((g) => ({
      name: g.name,
      coverUrl: g.coverUrl ?? null,
    })),
    playedWithCount: summary.playedWithCount,
    superlative: summary.superlative,
  });
}
