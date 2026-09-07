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
import type {
  LfgGroupChangedPayload,
  LfgGroupChangedReason,
} from '../../lfg/lfg.constants';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgConversionTarget } from '../../lfg/lfg-write.helpers';
import {
  TERMINAL_STATE,
  type LfmGroupView,
  type LfmRenderState,
  type LfmTarget,
} from './lfm-embed.helpers';
import {
  readConvertedGroup,
  readLiveGroup,
  readOpenLfgNowEventId,
  readPlayingSession,
  resolvePollTarget,
  LFM_FLOOR,
  type LfmGameRow,
} from './lfm-embed.db-helpers';

/** Just enough of a `Logger` for the one warning this module emits. */
interface ViewLogger {
  warn(message: string): void;
}

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
    // ROK-1479 D9 — a group renders as "now" from ONE now hand, so the class
    // is derived from the count rather than carried separately.
    nowCount: group.nowCount,
    urgency: group.nowCount >= 1 ? 'now' : 'week',
    soonestNowExpiresAt: group.soonestNowExpiresAt,
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
 * The PLAYING view (ROK-1494 D3/D5) — the ONLY non-terminal view past `open`.
 *
 * The head-count is read HERE, at render, never taken off the payload: the
 * `GROUP_CHANGED` family is documented count-free precisely so a burst of
 * joins cannot render a stale number.
 *
 * @param db - Drizzle handle.
 * @param game - The game the group is for.
 * @param eventId - The ad-hoc event the group spawned.
 * @returns The live-session view.
 */
export async function playingView(
  db: LfgDb,
  game: LfmGameRow,
  eventId: number,
): Promise<LfmGroupView> {
  const session = await readPlayingSession(db, game.id, eventId);
  return {
    ...baseView(game),
    state: 'playing',
    memberCount: session.count,
    memberNames: session.names,
    playingEventId: eventId,
    voiceChannelUrl: session.voiceChannelUrl,
  };
}

/**
 * ROK-1494 AC7 — **the one answer to "which view does this game deserve NOW?"**
 *
 * A game with an open LFG-born session renders `playing`, whatever else the
 * caller was about to read. Both callers go through here on purpose: the hot
 * path ({@link viewForChange}) and the restart reconcile
 * (`LfmEmbedService.reconcileView`) previously each held their own opinion, and
 * only the reconcile's was right — which is exactly how the round-2 fleet gate
 * failed. The spawn converts every intent, so the live read returns an EMPTY
 * group; letting it win paints `0 looking` over `▸ PLAYING NOW` and stamps
 * `last_member_count = 0`, and because `TERMINAL_STATE.playing` is null nothing
 * ever restores it.
 *
 * @param db - Drizzle handle.
 * @param game - The game the group is for.
 * @returns The `playing` view, or null when the game has no open session.
 */
export async function sessionView(
  db: LfgDb,
  game: LfmGameRow,
): Promise<LfmGroupView | null> {
  const eventId = await readOpenLfgNowEventId(db, game.id);
  if (eventId == null) return null;
  return playingView(db, game, eventId);
}

/**
 * The render state a change reason implies on its own, where it implies one.
 *
 * Only used to ask "does this reason END the group?" — `withdrawn` and
 * `joined` are absent because their state depends on the live head-count, and
 * neither is terminal on its own.
 */
const REASON_STATE: Partial<Record<LfgGroupChangedReason, LfmRenderState>> = {
  converted: 'scheduled',
  expired: 'expired',
  playing: 'playing',
};

/**
 * Does this reason end the group? {@link TERMINAL_STATE} is the ONE definition
 * of terminal, so a future state added there needs no second edit here.
 */
function endsTheGroup(reason: LfgGroupChangedReason): boolean {
  const state = REASON_STATE[reason];
  return state !== undefined && TERMINAL_STATE[state] !== null;
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

/**
 * The `converted` branch of `viewForChange`. Behaviour-neutral extraction
 * (ROK-1494): lifted out verbatim so the sixth branch does not push the
 * dispatcher past the 30-line function limit.
 *
 * @param db - Drizzle handle.
 * @param game - The game the group is for.
 * @param payload - The `GROUP_CHANGED` event.
 * @param logger - Where the missing-provenance warning goes.
 * @returns The converted view, or null meaning "leave it open".
 */
async function convertedBranch(
  db: LfgDb,
  game: LfmGameRow,
  payload: LfgGroupChangedPayload,
  logger: ViewLogger,
): Promise<LfmGroupView | null> {
  const target = conversionTarget(payload);
  if (!target) {
    logger.warn(
      `Converted LFM group for game ${String(game.id)} carries no provenance; leaving the message open for reconcile.`,
    );
    return null;
  }
  return convertedView(db, game, target);
}

/**
 * ROK-1494 — the `playing` branch of `viewForChange`, extracted for length.
 *
 * A `playing` transition ALWAYS carries `eventId` (`lfg.constants.ts`), so a
 * missing one is a broken emitter: warn and leave the message open for
 * reconcile rather than render a session with no session in it.
 */
async function playingBranch(
  db: LfgDb,
  game: LfmGameRow,
  payload: LfgGroupChangedPayload,
  logger: ViewLogger,
): Promise<LfmGroupView | null> {
  if (payload.eventId == null) {
    logger.warn(
      `Playing LFM group for game ${String(game.id)} carries no eventId; leaving the message open for reconcile.`,
    );
    return null;
  }
  return playingView(db, game, payload.eventId);
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

/**
 * D6 — the change's REASON picks the read.
 *
 * The three terminal reasons deliberately use three different strategies:
 * `converted` goes through provenance, `withdrawn` through the live read, and
 * `expired` has no readable roster at all. Unifying them is the defect that got
 * round 1 of ROK-1454 rejected, which is why this lives beside the three reads
 * rather than inside the service's orchestration.
 *
 * @param db - Drizzle handle.
 * @param game - The game the group is for.
 * @param lastMemberCount - The row's stamped head-count, for the expired render.
 * @param payload - The `GROUP_CHANGED` event.
 * @param logger - Where the missing-provenance warning goes.
 * @returns The view to render, or null meaning "cannot render, leave it open".
 */
export async function viewForChange(
  db: LfgDb,
  game: LfmGameRow,
  lastMemberCount: number,
  payload: LfgGroupChangedPayload,
  logger: ViewLogger,
): Promise<LfmGroupView | null> {
  // ROK-1494 AC7 — the live session outranks every non-terminal read. A
  // `converted` / `expired` change genuinely ends the group and must still be
  // able to close the row, so those two skip the lookup.
  if (!endsTheGroup(payload.reason)) {
    const session = await sessionView(db, game);
    if (session) return session;
  }
  if (payload.reason === 'expired') {
    // "A row of this game expired" is not "this group died": an ineligible
    // holder's stale hand expires alone while the eligible members, whose
    // clocks every +1 refreshed, stay live. Re-read exactly as `reconcileRow`
    // does and only go terminal below the floor.
    const live = await liveView(db, game);
    return live.memberCount >= LFM_FLOOR
      ? live
      : expiredView(game, lastMemberCount);
  }
  if (payload.reason === 'converted') {
    return convertedBranch(db, game, payload, logger);
  }
  // Above the fallthrough: the live read would render an OPEN group whose
  // intents have all converted, i.e. a head-count of zero and the wrong tag.
  if (payload.reason === 'playing') {
    return playingBranch(db, game, payload, logger);
  }
  const view = await liveView(db, game);
  // E12: 3 -> 2 is still LFM. Only dropping below the floor is terminal.
  if (payload.reason === 'withdrawn' && view.memberCount < LFM_FLOOR) {
    view.state = 'closed';
  }
  return view;
}
