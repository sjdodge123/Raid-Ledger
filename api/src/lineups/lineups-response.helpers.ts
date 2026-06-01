/**
 * Lineup response mapping helpers (ROK-933/934/935).
 * Maps raw query results to LineupDetailResponseDto with enrichment.
 */
import type {
  LineupDetailResponseDto,
  LineupEntryResponseDto,
  LineupInviteeResponseDto,
} from '@raid-ledger/contract';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NotFoundException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import { loadQuorumGatingVoters } from './quorum/quorum-voters.helpers';
import {
  findLineupById,
  findEntriesWithGames,
  countVotesPerGame,
  countDistinctVoters,
  findUserById,
  findGameName,
} from './lineups-query.helpers';
import {
  countOwnersPerGame,
  countWishlistPerGame,
  fetchPricingMetadata,
  countTotalMembers,
  countUnlinkedSteamMembers,
  findUnlinkedSteamMembers,
  type GamePricing,
  type LineupAudience,
  type UnlinkedSteamMember,
} from './lineups-enrichment.helpers';
import { findUserVotes } from './lineups-voting.helpers';
import { findPendingOrActiveTiebreaker } from './tiebreaker/tiebreaker-query.helpers';
import { buildTiebreakerDetail } from './tiebreaker/tiebreaker-response.helpers';
import { listInviteesWithProfile } from './lineups-invitees.helpers';
import { findViewerSubmissions } from './lineups-submissions-query.helpers';
import { computeVotingEligibleCount } from './voting-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Enrichment maps passed through to entry mapping. */
interface EnrichmentMaps {
  ownerMap: Map<number, number>;
  wishlistMap: Map<number, number>;
  pricingMap: Map<number, GamePricing>;
  totalMembers: number;
  unlinkedSteamCount: number;
  unlinkedSteamMembers: UnlinkedSteamMember[];
}

/** Map a single entry row to the response shape with enrichment. */
function mapEntry(
  e: Awaited<ReturnType<typeof findEntriesWithGames>>[0],
  voteMap: Map<number, number>,
  enrichment: EnrichmentMaps,
): LineupEntryResponseDto {
  const ownerCount = enrichment.ownerMap.get(e.gameId) ?? 0;
  const pricing = enrichment.pricingMap.get(e.gameId);

  return {
    id: e.id,
    gameId: e.gameId,
    gameName: e.gameName,
    gameCoverUrl: e.gameCoverUrl,
    nominatedBy: { id: e.nominatedById, displayName: e.nominatedByName },
    note: e.note,
    carriedOver: e.carriedOverFrom !== null,
    voteCount: voteMap.get(e.gameId) ?? 0,
    createdAt: e.createdAt.toISOString(),
    ownerCount,
    totalMembers: enrichment.totalMembers,
    nonOwnerCount: enrichment.totalMembers - ownerCount,
    wishlistCount: enrichment.wishlistMap.get(e.gameId) ?? 0,
    itadCurrentPrice: pricing?.itadCurrentPrice ?? null,
    itadCurrentCut: pricing?.itadCurrentCut ?? null,
    itadCurrentShop: pricing?.itadCurrentShop ?? null,
    itadCurrentUrl: pricing?.itadCurrentUrl ?? null,
    playerCount: e.playerCount ?? null,
  };
}

/** Extract core lineup metadata fields. */
function mapLineupCore(
  lineup: typeof schema.communityLineups.$inferSelect,
  creator: Awaited<ReturnType<typeof findUserById>>,
  decidedGame: Awaited<ReturnType<typeof findGameName>>,
  channelOverrideName: string | null,
) {
  return {
    id: lineup.id,
    title: lineup.title,
    description: lineup.description ?? null,
    status: lineup.status,
    targetDate: lineup.targetDate?.toISOString() ?? null,
    decidedGameId: lineup.decidedGameId,
    decidedGameName: decidedGame[0]?.name ?? null,
    linkedEventId: lineup.linkedEventId,
    createdBy: creator[0] ?? { id: lineup.createdBy, displayName: 'Unknown' },
    votingDeadline: lineup.votingDeadline?.toISOString() ?? null,
    phaseDeadline: lineup.phaseDeadline?.toISOString() ?? null,
    // ROK-1253: grace window and revert-pause stamps surfaced to clients.
    pendingAdvanceAt: lineup.pendingAdvanceAt?.toISOString() ?? null,
    autoAdvancePausedAt: lineup.autoAdvancePausedAt?.toISOString() ?? null,
    matchThreshold: lineup.matchThreshold ?? 35,
    maxVotesPerPlayer: lineup.maxVotesPerPlayer ?? 3,
    defaultTiebreakerMode: lineup.defaultTiebreakerMode ?? null,
    createdAt: lineup.createdAt.toISOString(),
    updatedAt: lineup.updatedAt.toISOString(),
    // ROK-1064: per-lineup Discord channel override + resolved name.
    channelOverrideId: lineup.channelOverrideId ?? null,
    channelOverrideName,
    // ROK-1065: visibility drives DM vs channel embed dispatch.
    visibility: lineup.visibility,
    // ROK-1067: public-share toggle + URL-safe slug for the share URL.
    publicShareEnabled: lineup.publicShareEnabled,
    publicSlug: lineup.publicSlug,
    // ROK-1302: whether the decided lineup advances into a scheduling poll.
    includeSchedulingPhase: lineup.includeSchedulingPhase,
  };
}

/** Map raw query results to the detail response shape. */
function mapToDetailResponse(
  lineup: typeof schema.communityLineups.$inferSelect,
  entries: Awaited<ReturnType<typeof findEntriesWithGames>>,
  voteCounts: Awaited<ReturnType<typeof countVotesPerGame>>,
  voterCount: Awaited<ReturnType<typeof countDistinctVoters>>,
  creator: Awaited<ReturnType<typeof findUserById>>,
  decidedGame: Awaited<ReturnType<typeof findGameName>>,
  enrichment: EnrichmentMaps,
  myVotes: number[],
  channelOverrideName: string | null,
): LineupDetailResponseDto {
  const voteMap = new Map(voteCounts.map((v) => [v.gameId, v.voteCount]));
  return {
    ...mapLineupCore(lineup, creator, decidedGame, channelOverrideName),
    entries: entries.map((e) => mapEntry(e, voteMap, enrichment)),
    totalVoters: voterCount[0]?.total ?? 0,
    totalMembers: enrichment.totalMembers,
    myVotes,
    unlinkedSteamCount: enrichment.unlinkedSteamCount,
    unlinkedSteamMembers: enrichment.unlinkedSteamMembers,
    // ROK-1065: populated below via a parallel query.
    invitees: [],
    // ROK-1258: populated below for private voting lineups; empty otherwise.
    stillWaitingOnVoters: [],
    // ROK-1296: populated by buildDetailResponse via a parallel query.
    // Stubbed null/null at the mapper boundary so the type compiles even when
    // the caller is unauthenticated; the response builder overwrites both.
    viewerSubmissions: {
      nominationsSubmittedAt: null,
      votesSubmittedAt: null,
    },
    // ROK-1298: voter-pool denominator for Sv vote bars. Stubbed at 1
    // (creator floor) here; buildDetailResponse overwrites with the real
    // value once invitees + enrichment are available.
    votingEligibleCount: 1,
  };
}

/**
 * ROK-1258: Resolve the invitees currently blocking quorum — i.e. invitees
 * who are in the active quorum-gating set AND haven't met their full vote
 * allotment. Mirrors `loadQuorumGatingVoters`'s hybrid policy so the panel
 * never names invitees who have already been dropped post-deadline (which
 * would make the panel contradict the auto-advance state). Creator is
 * always excluded — the panel is about who else the creator is waiting on.
 *
 * Returns `[]` for any non-voting or non-private lineup, OR when nobody is
 * blocking quorum (either everyone has met their allotment or the gating
 * set has collapsed under the hybrid policy).
 */
async function loadStillWaitingOnVoters(
  db: Db,
  lineup: typeof schema.communityLineups.$inferSelect,
  invitees: LineupInviteeResponseDto[],
): Promise<LineupInviteeResponseDto[]> {
  if (lineup.status !== 'voting' || lineup.visibility !== 'private') return [];
  if (invitees.length === 0) return [];
  const required = lineup.maxVotesPerPlayer ?? 3;
  const [gatingIds, voteRows] = await Promise.all([
    loadQuorumGatingVoters(db, lineup),
    db
      .select({
        userId: schema.communityLineupVotes.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.communityLineupVotes)
      .where(eq(schema.communityLineupVotes.lineupId, lineup.id))
      .groupBy(schema.communityLineupVotes.userId),
  ]);
  const gatingSet = new Set(gatingIds);
  const counts = new Map(voteRows.map((r) => [r.userId, Number(r.count)]));
  return invitees.filter(
    (invitee) =>
      invitee.id !== lineup.createdBy &&
      gatingSet.has(invitee.id) &&
      (counts.get(invitee.id) ?? 0) < required,
  );
}

/** Fetch enrichment data for lineup entries. */
async function fetchEnrichment(
  db: Db,
  gameIds: number[],
  audience: LineupAudience,
): Promise<EnrichmentMaps> {
  const [ownerMap, wishlistMap, pricingMap, totalMembers, uc, um] =
    await Promise.all([
      countOwnersPerGame(db, gameIds),
      countWishlistPerGame(db, gameIds),
      fetchPricingMetadata(db, gameIds),
      countTotalMembers(db),
      countUnlinkedSteamMembers(db, audience),
      findUnlinkedSteamMembers(db, audience),
    ]);
  return {
    ownerMap,
    wishlistMap,
    pricingMap,
    totalMembers,
    unlinkedSteamCount: uc,
    unlinkedSteamMembers: um,
  };
}

/**
 * Callback for resolving a Discord channel name from its ID (ROK-1064).
 * Callers inject this to avoid a hard dependency on the Discord bot client.
 */
export type ResolveChannelName = (channelId: string) => string | null;

/** Assemble the full detail response for a lineup. */
export async function buildDetailResponse(
  db: Db,
  lineupId: number,
  userId?: number,
  resolveChannelName?: ResolveChannelName,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');

  const [
    entries,
    voteCounts,
    voterCount,
    creator,
    decidedGame,
    myVotes,
    invitees,
    viewerSubmissions,
  ] = await Promise.all([
    findEntriesWithGames(db, lineupId),
    countVotesPerGame(db, lineupId),
    countDistinctVoters(db, lineupId),
    findUserById(db, lineup.createdBy),
    lineup.decidedGameId
      ? findGameName(db, lineup.decidedGameId)
      : Promise.resolve([]),
    findUserVotes(db, lineupId, userId),
    // ROK-1252: pulled into the parallel batch so the audience is available
    // before fetchEnrichment runs.
    listInviteesWithProfile(db, lineupId),
    // ROK-1296: viewer's per-phase submit timestamps for the SubmitBar.
    findViewerSubmissions(db, lineupId, userId),
  ]);

  // ROK-1252: scope steam-link enrichment to the lineup audience.
  const audience: LineupAudience = {
    visibility: lineup.visibility,
    createdBy: lineup.createdBy,
    inviteeUserIds: invitees.map((i) => i.id),
  };
  const enrichment = await fetchEnrichment(
    db,
    entries.map((e) => e.gameId),
    audience,
  );
  const channelOverrideName = lineup.channelOverrideId
    ? (resolveChannelName?.(lineup.channelOverrideId) ?? null)
    : null;
  const detail = mapToDetailResponse(
    lineup,
    entries,
    voteCounts,
    voterCount,
    creator,
    decidedGame,
    enrichment,
    myVotes,
    channelOverrideName,
  );
  // ROK-1065: invitees populated for both public (empty) and private lineups.
  detail.invitees = invitees;
  // ROK-1258: still-waiting-on-voters panel for private voting lineups.
  detail.stillWaitingOnVoters = await loadStillWaitingOnVoters(
    db,
    lineup,
    invitees,
  );
  // ROK-1296: replace the stub from mapToDetailResponse with the real
  // viewer-scoped row. Both fields are null when userId is undefined.
  detail.viewerSubmissions = viewerSubmissions;
  // ROK-1298: voter-pool denominator for Sv vote bars. Private =
  // creator + invitees (deduped); public = totalMembers; floor at 1.
  detail.votingEligibleCount = computeVotingEligibleCount(
    { createdBy: lineup.createdBy, visibility: lineup.visibility },
    invitees.map((i) => ({ id: i.id })),
    enrichment.totalMembers,
  );

  // Attach tiebreaker detail if one exists (ROK-938)
  if (lineup.activeTiebreakerId) {
    const [tb] = await findPendingOrActiveTiebreaker(db, lineupId);
    if (tb) {
      (detail as Record<string, unknown>).tiebreaker =
        await buildTiebreakerDetail(db, tb, userId);
    }
  } else {
    (detail as Record<string, unknown>).tiebreaker = null;
  }

  return detail;
}
