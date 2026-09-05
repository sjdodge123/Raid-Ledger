/**
 * The three read strategies behind the LFM renders (D6), factored out of the
 * service so it keeps to orchestration and Discord I/O:
 *
 * - `liveView` — the live read, for every open state (D8) and for a
 *   withdrawal (D6b: the survivors genuinely are live).
 * - `convertedView` — the provenance read (D5), never `liveIntent`.
 * - `expiredView` — `last_member_count`, because an expired group has no
 *   readable roster (D6c).
 */
import type { LfgMemberDto } from '@raid-ledger/contract';
import type { LfgGroupChangedPayload } from '../../lfg/lfg.constants';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgConversionTarget } from '../../lfg/lfg-write.helpers';
import type { LfmGroupView, LfmTarget } from './lfm-embed.helpers';
import {
  readConvertedGroup,
  readLiveGroup,
  resolvePollTarget,
  type LfmGameRow,
} from './lfm-embed.db-helpers';

/** The open-state view: the live read, unchanged (D8). */
export async function liveView(
  db: LfgDb,
  game: LfmGameRow,
): Promise<LfmGroupView> {
  const group = await readLiveGroup(db, game);
  return {
    ...baseView(game),
    state: 'open',
    memberCount: group.members.length,
    memberNames: displayNames(group.members),
    viabilityThreshold: group.viabilityThreshold,
    // The games row IS the badge projection — `EMBED_GAME_BADGE_COLUMNS`
    // selects exactly these ten columns off it.
    badges: game,
    expiresAt: group.soonestExpiresAt,
  };
}

/** The SCHEDULED view: provenance roster (D5) plus the target link. */
export async function convertedView(
  db: LfgDb,
  game: LfmGameRow,
  target: LfgConversionTarget,
): Promise<LfmGroupView> {
  const members = await readConvertedGroup(db, game.id, target);
  return {
    ...baseView(game),
    state: 'scheduled',
    memberCount: members.length,
    memberNames: displayNames(members),
    target: await linkTarget(db, target),
  };
}

/**
 * The EXPIRED view (D6c). There is NO readable roster: every intent is
 * `status = 'expired'` and `lfg_intents` has no group id, so filtering by game
 * would sweep in every past group's corpses. The stored count is the only
 * honest number available.
 */
export function expiredView(
  game: LfmGameRow,
  lastMemberCount: number,
): LfmGroupView {
  return {
    ...baseView(game),
    state: 'expired',
    memberCount: lastMemberCount,
  };
}

/** The provenance key a `converted` transition carries, or null. */
export function conversionTarget(
  payload: LfgGroupChangedPayload,
): LfgConversionTarget | null {
  if (payload.pollId != null) return { pollId: payload.pollId };
  if (payload.eventId != null) return { eventId: payload.eventId };
  return null;
}

/**
 * The link that replaces the group link at SCHEDULED.
 *
 * `pollId` is ALREADY `community_lineup_matches.id`, so the poll branch only
 * needs the lineup that owns it — the route's final segment is the MATCH id.
 */
async function linkTarget(
  db: LfgDb,
  target: LfgConversionTarget,
): Promise<LfmTarget | null> {
  if (target.pollId !== undefined) {
    return resolvePollTarget(db, target.pollId);
  }
  return { kind: 'event', eventId: target.eventId as number };
}

/** The fields every render carries, whatever state it is in. */
function baseView(
  game: LfmGameRow,
): Pick<LfmGroupView, 'gameId' | 'gameName' | 'gameSlug' | 'gameCoverUrl'> {
  return {
    gameId: game.id,
    gameName: game.name,
    gameSlug: game.slug,
    gameCoverUrl: game.coverUrl,
  };
}

/** Roster display names, in the order the read returned them. */
function displayNames(members: LfgMemberDto[]): string[] {
  return members.map((m) => m.displayName ?? m.username);
}
