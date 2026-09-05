/**
 * ROK-1374 (Lane B) — the three tie notification orchestrators.
 *
 * Mirrors `lineup-notification-tiebreaker.helpers.ts`: DM the expected-voter
 * roster (visibility-aware via `loadExpectedVoters`, so a PRIVATE tie still
 * reaches its invitees — E22 suppresses only the channel embed), then announce
 * or re-render the single channel message.
 *
 * Detection ANNOUNCES; the decided and expired events EDIT. That asymmetry is
 * D7 in one line: a tie owns exactly one Discord message for its whole life.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { DEDUP_TTL } from './lineup-notification.constants';
import { findDiscordMembersByUserIds } from './lineup-notification-targets.helpers';
import {
  buildTieDecidedEmbed,
  buildTieExpiredEmbed,
  type TieEmbedGame,
} from './lineup-notification-tie-embed.helpers';
import { findGamesByIds } from './lineups-query.helpers';
import { loadExpectedVoters } from './quorum/quorum-voters.helpers';
import {
  announceTie,
  editTieAnnounce,
} from './tiebreaker/tie-announce.helpers';
import type { OrchestrationDeps } from './lineup-notification-public-dispatch.helpers';
import type { LineupInfo } from './lineup-notification.service';
import type { TieResult } from './tiebreaker/tiebreaker-detect.helpers';

type LineupRow = typeof schema.communityLineups.$inferSelect;

/** One DM, before it is personalised with a recipient. */
interface TieDm {
  key: string;
  title: string;
  message: string;
  subtype: string;
}

/** The lineup row plus the roster the tie is scoped to. */
interface TieAudience {
  row: LineupRow;
  userIds: number[];
}

/** Load the row + its expected voters. Null when the lineup vanished. */
async function loadAudience(
  deps: OrchestrationDeps,
  lineupId: number,
): Promise<TieAudience | null> {
  const [row] = await deps.db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!row) return null;
  return { row, userIds: await loadExpectedVoters(deps.db, row) };
}

/** `https://…/community-lineup/42` — the one link every tie DM carries. */
async function lineupUrl(
  deps: OrchestrationDeps,
  lineupId: number,
): Promise<string> {
  const base = (await deps.settingsService.getClientUrl()) ?? '';
  return `${base}/community-lineup/${lineupId}`;
}

/** ` — Friday Co-op`, or nothing when the lineup is untitled. */
function titleSuffix(lineup: LineupInfo): string {
  return lineup.title ? ` — ${lineup.title}` : '';
}

/** `Deep Rock Galactic and Valheim`. */
function nameList(games: ReadonlyArray<TieEmbedGame>): string {
  return games.map((game) => `**${game.name}**`).join(' and ');
}

/** DM every Discord-linked member of the roster, at most once each. */
async function fanOutTieDMs(
  deps: OrchestrationDeps,
  lineupId: number,
  userIds: ReadonlyArray<number>,
  dm: TieDm,
): Promise<void> {
  const members = await findDiscordMembersByUserIds(deps.db, userIds);
  for (const member of members) {
    const key = `${dm.key}:${member.userId}`;
    if (await deps.dedupService.checkAndMarkSent(key, DEDUP_TTL)) continue;
    await deps.notificationService.create({
      userId: member.userId,
      type: 'community_lineup',
      title: dm.title,
      message: dm.message,
      payload: { subtype: dm.subtype, lineupId },
    });
  }
}

/**
 * The vote finished with no decidable winner: DM the roster and announce.
 *
 * @param deps - Composed notification deps.
 * @param lineup - The lineup holding the tie.
 * @param tie - Tied game ids + the shared top vote count.
 */
export async function notifyTieDetected(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
  tie: TieResult,
): Promise<void> {
  const audience = await loadAudience(deps, lineup.id);
  if (!audience) return;
  const games = await findGamesByIds(deps.db, tie.tiedGameIds);
  const link = await lineupUrl(deps, lineup.id);
  await fanOutTieDMs(deps, lineup.id, audience.userIds, {
    key: `lineup-tie-detected-dm:${lineup.id}`,
    title: `Voting tied${titleSuffix(lineup)}`,
    message:
      `Voting ended in a tie between ${nameList(games)} ` +
      `(${tie.voteCount} votes each). Nothing is decided until somebody ` +
      `picks — compare them here: ${link}`,
    subtype: 'lineup_tie_detected',
  });
  await announceTie(
    deps,
    { ...lineup, visibility: audience.row.visibility },
    { tiedGames: games, rosterSize: audience.userIds.length },
  );
}

/**
 * A human picked a game: DM the roster and EDIT the announced message.
 *
 * @param deps - Composed notification deps.
 * @param lineup - The lineup holding the tie.
 * @param game - The picked game.
 * @param pickedBy - Display name of the creator/operator who picked.
 * @param owned - Roster-scoped ownership aggregate for the picked game.
 * @param pickedById - The picker's user id; they are not told about their
 *   own pick (the DM inventory says "to those who did not pick").
 */
export async function notifyTieDecided(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
  game: TieEmbedGame,
  pickedBy: string,
  owned: { count: number; rosterSize: number },
  pickedById: number | null = null,
): Promise<void> {
  const audience = await loadAudience(deps, lineup.id);
  if (!audience) return;
  const link = await lineupUrl(deps, lineup.id);
  const recipients = audience.userIds.filter((id) => id !== pickedById);
  await fanOutTieDMs(deps, lineup.id, recipients, {
    key: `lineup-tie-decided-dm:${lineup.id}`,
    title: `${game.name} won the tie${titleSuffix(lineup)}`,
    message:
      `**${game.name}** settled the tie — picked by ${pickedBy}. ` +
      `Details: ${link}`,
    subtype: 'lineup_tie_decided',
  });
  await editTieAnnounce(deps, lineup, (ctx) =>
    buildTieDecidedEmbed(ctx, game, pickedBy, owned),
  );
}

/**
 * The hold expired with no pick (D13): DM the roster and EDIT the message.
 *
 * Expiry decides nothing, so the copy says exactly that.
 *
 * @param deps - Composed notification deps.
 * @param lineup - The lineup whose hold expired.
 */
export async function notifyTieExpired(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
): Promise<void> {
  const audience = await loadAudience(deps, lineup.id);
  if (!audience) return;
  const games = await findGamesByIds(deps.db, audience.row.tieGameIds ?? []);
  const link = await lineupUrl(deps, lineup.id);
  await fanOutTieDMs(deps, lineup.id, audience.userIds, {
    key: `lineup-tie-expired-dm:${lineup.id}`,
    title: `Tie expired${titleSuffix(lineup)}`,
    message: `Nobody picked — the lineup closed without a decision. ${link}`,
    subtype: 'lineup_tie_expired',
  });
  await editTieAnnounce(deps, lineup, (ctx) =>
    buildTieExpiredEmbed(ctx, games),
  );
}
