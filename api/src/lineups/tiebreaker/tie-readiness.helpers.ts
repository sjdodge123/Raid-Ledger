/**
 * ROK-1374 (C1) — the readiness card's data path.
 *
 * A tie parks the lineup; this builds the comparison the group decides from.
 * It is a decision AID and nothing else: it reports who already owns each tied
 * game, how big each one is, and how long the viewer would wait for it. It
 * never ranks, scores or selects — Q2 forbids the tool picking a winner even
 * as a fallback.
 *
 * Ownership is scoped to `loadExpectedVoters` (AC11). A community-wide count
 * answers a question nobody asked and inflates every row, which is exactly the
 * kind of confidently-wrong number that decides a tie badly.
 *
 * Five queries total regardless of how many games tied — roster, games,
 * roster ownership, the viewer's own ownership, and the two or three people
 * named on the card. No N+1.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  InstallSizeSource,
  TieReadinessGameDto,
  TieReadinessResponseDto,
  UserRole,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import { countOwnersPerGame } from '../lineups-enrichment.helpers';
import { loadExpectedVoters } from '../quorum/quorum-voters.helpers';
import { deriveTieHold } from './tie-hold.helpers';
import {
  buildRosterEtas,
  estimateDownloadMinutes,
  type RosterEtaPerson,
} from './tie-readiness-roster-eta.helpers';

/** Re-exported: the arithmetic lives with the ETA rows that all use it. */
export { estimateDownloadMinutes };

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** The authenticated caller, as the card needs to know them. */
export interface TieReadinessViewer {
  id: number;
  role: UserRole;
}

interface Person {
  username: string;
  displayName: string | null;
  mbps: number | null;
  measuredAt: Date | null;
  /** Null = has not opted in to sharing their ETA with rosters (default). */
  shareEtaAt: Date | null;
}

/**
 * D15/D16: the pick is row-scoped, not role-scoped. The creator may pick their
 * own lineup; an operator/admin may pick any. Everyone else on the roster sees
 * the comparison but no button — first-click-wins by any voter was rejected.
 */
export function canPickTie(
  lineup: LineupRow,
  viewer: TieReadinessViewer,
): boolean {
  return isOperatorOrAdmin(viewer.role) || lineup.createdBy === viewer.id;
}

/**
 * Build the readiness payload for one viewer of one tie-held lineup.
 *
 * `knownRoster` lets the caller reuse the roster it already loaded for the
 * membership check (E21) instead of paying for it twice.
 */
export async function buildTieReadiness(
  db: Db,
  lineup: LineupRow,
  viewer: TieReadinessViewer,
  knownRoster?: number[],
): Promise<TieReadinessResponseDto> {
  const hold = deriveTieHold(lineup);
  const gameIds = hold.tiedGameIds;
  const roster = knownRoster ?? (await loadExpectedVoters(db, lineup));
  const [gameRows, owners, viewerOwns, people] = await Promise.all([
    loadTieGames(db, gameIds),
    countOwnersPerGame(db, gameIds, roster),
    loadViewerOwned(db, gameIds, viewer.id),
    loadPeople(db, [lineup.createdBy, viewer.id, lineup.tiePickBy, ...roster]),
  ]);
  const me = people.get(viewer.id) ?? null;
  const rosterPeople = toRosterEtaPeople(roster, people);
  const games = toReadinessGames(gameIds, gameRows, owners, viewerOwns, {
    voteCount: hold.voteCount ?? 0,
    rosterSize: roster.length,
    viewerMbps: me?.mbps ?? null,
    roster: rosterPeople,
    viewerId: viewer.id,
  });
  return {
    lineupId: lineup.id,
    status: hold.status,
    voteCount: hold.voteCount ?? 0,
    games,
    rosterSize: roster.length,
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    pick: buildPick(lineup, people),
    canPick: canPickTie(lineup, viewer),
    pickerName: people.get(lineup.createdBy)?.username ?? null,
    viewerSpeedMbps: me?.mbps ?? null,
    viewerSpeedMeasuredAt: me?.measuredAt?.toISOString() ?? null,
  };
}

/** Everything on the card that does not vary game by game. */
type SharedRowContext = Omit<RowContext, 'ownedCount' | 'youOwn'>;

/** One row per tied game, in tie order; an id with no games row is dropped. */
function toReadinessGames(
  gameIds: number[],
  gameRows: Map<number, TieGameRow>,
  owners: Map<number, number>,
  viewerOwns: Set<number>,
  shared: SharedRowContext,
): TieReadinessGameDto[] {
  return gameIds
    .map((id) => gameRows.get(id))
    .filter((row): row is TieGameRow => row !== undefined)
    .map((row) =>
      toReadinessGame(row, {
        ...shared,
        ownedCount: owners.get(row.gameId) ?? 0,
        youOwn: viewerOwns.has(row.gameId),
      }),
    );
}

export interface RowContext {
  voteCount: number;
  ownedCount: number;
  rosterSize: number;
  youOwn: boolean;
  viewerMbps: number | null;
  /** Everyone on the roster, in roster order — one ETA row each. */
  roster: RosterEtaPerson[];
  viewerId: number;
}

/**
 * The roster, in roster order, as ETA rows need it. A roster id with no user
 * row (deleted mid-lineup) is dropped rather than named "Unknown".
 */
function toRosterEtaPeople(
  roster: number[],
  people: Map<number, Person>,
): RosterEtaPerson[] {
  return roster.flatMap((id) => {
    const person = people.get(id);
    if (person === undefined) return [];
    return [
      {
        userId: id,
        displayName: person.displayName ?? person.username,
        mbps: person.mbps,
        shareEtaAt: person.shareEtaAt,
      },
    ];
  });
}

/** Project one game row + its aggregates onto the contract shape. */
export function toReadinessGame(
  row: TieGameRow,
  ctx: RowContext,
): TieReadinessGameDto {
  // The download footprint is the honest input, but the only shipped entry
  // path — the card's "Size unknown · Add it" modal — records an INSTALL size
  // and leaves this null, so an install size is the fallback. It mirrors the
  // figure the row already displays, and an estimate off the installed
  // footprint beats no estimate at all.
  const sizeBytes = row.downloadSizeBytes ?? row.installSizeBytes;
  return {
    gameId: row.gameId,
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl,
    voteCount: ctx.voteCount,
    steamAppId: row.steamAppId,
    ownedCount: ctx.ownedCount,
    rosterSize: ctx.rosterSize,
    youOwn: ctx.youOwn,
    installSizeBytes: row.installSizeBytes,
    downloadSizeBytes: row.downloadSizeBytes,
    installSizeSource: (row.installSizeSource as InstallSizeSource) ?? null,
    installSizeUpdatedAt: row.installSizeUpdatedAt?.toISOString() ?? null,
    estimatedDownloadMinutes: estimateDownloadMinutes(
      sizeBytes,
      ctx.viewerMbps,
    ),
    rosterEtas: buildRosterEtas(ctx.roster, sizeBytes, ctx.viewerId),
  };
}

/**
 * `finalAt` is the grace claim the pick armed — the moment it stops being
 * reversible. Absent all three pick columns there is no pick to report.
 */
function buildPick(
  lineup: LineupRow,
  people: Map<number, Person>,
): TieReadinessResponseDto['pick'] {
  const { tiePickGameId, tiePickAt, tiePickBy } = lineup;
  if (tiePickGameId === null || tiePickAt === null || tiePickBy === null) {
    return null;
  }
  return {
    gameId: tiePickGameId,
    at: tiePickAt.toISOString(),
    byUserId: tiePickBy,
    byUsername: people.get(tiePickBy)?.username ?? 'Unknown',
    finalAt: (lineup.pendingAdvanceAt ?? tiePickAt).toISOString(),
  };
}

export interface TieGameRow {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  steamAppId: number | null;
  installSizeBytes: number | null;
  downloadSizeBytes: number | null;
  installSizeSource: string | null;
  installSizeUpdatedAt: Date | null;
}

async function loadTieGames(
  db: Db,
  gameIds: number[],
): Promise<Map<number, TieGameRow>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameId: schema.games.id,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      steamAppId: schema.games.steamAppId,
      installSizeBytes: schema.games.installSizeBytes,
      downloadSizeBytes: schema.games.downloadSizeBytes,
      installSizeSource: schema.games.installSizeSource,
      installSizeUpdatedAt: schema.games.installSizeUpdatedAt,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, gameIds));
  return new Map(rows.map((r) => [r.gameId, r]));
}

/** The viewer's own Steam library, for the tied games only. One query. */
async function loadViewerOwned(
  db: Db,
  gameIds: number[],
  viewerId: number,
): Promise<Set<number>> {
  if (gameIds.length === 0) return new Set();
  const rows = await db
    .select({ gameId: schema.gameInterests.gameId })
    .from(schema.gameInterests)
    .where(
      and(
        inArray(schema.gameInterests.gameId, gameIds),
        eq(schema.gameInterests.userId, viewerId),
        eq(schema.gameInterests.source, 'steam_library'),
      ),
    );
  return new Set(rows.map((r) => r.gameId));
}

/**
 * The creator, the viewer, (when set) whoever picked, and the whole roster —
 * still ONE query. `mbps` is read here for every roster member but leaves this
 * module only as MINUTES via `buildRosterEtas`, and only for members who
 * opted in; `viewerSpeedMbps` remains the viewer's own row alone (AC20).
 */
async function loadPeople(
  db: Db,
  ids: (number | null)[],
): Promise<Map<number, Person>> {
  const wanted = Array.from(
    new Set(ids.filter((id): id is number => typeof id === 'number')),
  );
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      mbps: schema.users.connectionDownstreamMbps,
      measuredAt: schema.users.connectionSpeedMeasuredAt,
      shareEtaAt: schema.users.shareDownloadEtaAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, wanted));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        username: r.username,
        displayName: r.displayName,
        mbps: parseMbps(r.mbps),
        measuredAt: r.measuredAt,
        shareEtaAt: r.shareEtaAt,
      },
    ]),
  );
}

/** `numeric` comes back as a string; a non-numeric value means "unknown". */
function parseMbps(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
