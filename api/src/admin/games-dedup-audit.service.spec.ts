/**
 * ROK-1271: unit spec for GamesDedupAuditService and helpers.
 *
 * Uses Drizzle chain mocks (pattern from demo-test-reset.service.spec.ts).
 * Covers bucketing, canonical pick, blast-radius wiring, and full
 * service orchestration for igdb/steam/name dup paths.
 */
import { Test } from '@nestjs/testing';
import { GamesDedupAuditService } from './games-dedup-audit.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import {
  bucketRowsByDedupKey,
  pickCanonicalId,
  type GameRow,
} from './games-dedup-audit.helpers';

function zeros(n: number): number[] {
  return Array.from<number>({ length: n }).fill(0);
}

function row(
  partial: Partial<GameRow> & { id: number; name: string },
): GameRow {
  return {
    slug: `slug-${partial.id}`,
    igdbId: null,
    itadGameId: null,
    steamAppId: null,
    cachedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

describe('bucketRowsByDedupKey', () => {
  it('groups two rows that share an igdbId under one igdb key', () => {
    const rows = [
      row({ id: 1, name: 'A', igdbId: 100 }),
      row({ id: 2, name: 'B', igdbId: 100 }),
    ];
    const buckets = bucketRowsByDedupKey(rows);
    expect(buckets.size).toBe(1);
    expect(buckets.get('igdb:100')).toHaveLength(2);
  });

  it('groups two rows that share a steamAppId under a steam key (no igdbId)', () => {
    const rows = [
      row({ id: 3, name: 'Foo', steamAppId: 555 }),
      row({ id: 4, name: 'Foo2', steamAppId: 555 }),
    ];
    const buckets = bucketRowsByDedupKey(rows);
    expect(buckets.size).toBe(1);
    expect(buckets.get('steam:555')).toHaveLength(2);
  });

  it('groups rows by normalized name when neither igdb nor steam keys match', () => {
    const rows = [
      row({ id: 5, name: 'Slay the Spire 2' }),
      row({ id: 6, name: 'Slay the Spire II' }),
    ];
    const buckets = bucketRowsByDedupKey(rows);
    expect(buckets.size).toBe(1);
    const [[, group]] = [...buckets.entries()];
    expect(group).toHaveLength(2);
  });

  it('prefers igdb over steam over name when multiple keys apply', () => {
    // Same igdbId but different steam and name — must bucket by igdb only.
    const rows = [
      row({ id: 7, name: 'Alpha', igdbId: 1, steamAppId: 11 }),
      row({ id: 8, name: 'Beta', igdbId: 1, steamAppId: 22 }),
    ];
    const buckets = bucketRowsByDedupKey(rows);
    expect(buckets.size).toBe(1);
    expect(buckets.get('igdb:1')).toHaveLength(2);
  });

  it('returns single-row buckets when no rows share keys (caller filters > 1)', () => {
    const rows = [
      row({ id: 9, name: 'Alone One', igdbId: 9 }),
      row({ id: 10, name: 'Alone Two', igdbId: 10 }),
    ];
    const buckets = bucketRowsByDedupKey(rows);
    expect(buckets.size).toBe(2);
    expect([...buckets.values()].every((g) => g.length === 1)).toBe(true);
  });
});

describe('pickCanonicalId', () => {
  it('prefers row with non-null itadGameId', () => {
    const rows = [
      row({ id: 11, name: 'A', igdbId: 1 }),
      row({ id: 12, name: 'B', igdbId: 2, itadGameId: 'itad-abc' }),
    ];
    expect(pickCanonicalId(rows)).toBe(12);
  });

  it('falls back to row with non-null igdbId when no itad', () => {
    const rows = [
      row({ id: 13, name: 'A' }),
      row({ id: 14, name: 'B', igdbId: 999 }),
    ];
    expect(pickCanonicalId(rows)).toBe(14);
  });

  it('falls back to lowest id when no itad and no igdb', () => {
    const rows = [
      row({ id: 20, name: 'A' }),
      row({ id: 15, name: 'B' }),
      row({ id: 18, name: 'C' }),
    ];
    expect(pickCanonicalId(rows)).toBe(15);
  });

  it('uses lowest id among itad candidates when multiple have itadGameId', () => {
    const rows = [
      row({ id: 21, name: 'A', itadGameId: 'x' }),
      row({ id: 19, name: 'B', itadGameId: 'y' }),
    ];
    expect(pickCanonicalId(rows)).toBe(19);
  });
});

/**
 * Drizzle chain mock.
 *
 * - The service's "load all rows" call (`db.select({...}).from(games)`) is
 *   thenable: `.from(...)` is awaited directly. We detect it by exposing a
 *   `then` on the `from` return value, and we trigger it only when no
 *   `.where(...)` follows.
 * - Per-id count queries call `.where(...)` which resolves to the next entry
 *   in `countSnapshots`. The lineupMatchMembers JOIN goes through
 *   `db.execute(...)`, which uses the same snapshot index.
 */
function buildDbMock(
  loadRows: () => GameRow[] | Promise<GameRow[]>,
  countSnapshots: number[],
) {
  let idx = 0;
  const nextCount = () => {
    const v = countSnapshots[idx] ?? 0;
    idx += 1;
    return [{ c: v }];
  };
  const db = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(nextCount())),
        then: (resolve: (v: GameRow[]) => unknown) =>
          Promise.resolve(loadRows()).then(resolve),
      })),
    })),
    execute: jest.fn(() => Promise.resolve(nextCount())),
  };
  return { db, getQueryCount: () => idx };
}

async function buildService(
  loadRows: () => GameRow[] | Promise<GameRow[]>,
  countSnapshots: number[],
): Promise<{
  svc: GamesDedupAuditService;
  dbMock: ReturnType<typeof buildDbMock>;
}> {
  const dbMock = buildDbMock(loadRows, countSnapshots);
  const module = await Test.createTestingModule({
    providers: [
      GamesDedupAuditService,
      { provide: DrizzleAsyncProvider, useValue: dbMock.db },
    ],
  }).compile();
  return { svc: module.get(GamesDedupAuditService), dbMock };
}

describe('GamesDedupAuditService.runAudit', () => {
  it('returns empty result when no games rows exist', async () => {
    const { svc } = await buildService(() => [], []);
    const result = await svc.runAudit();
    expect(result.summary.totalGames).toBe(0);
    expect(result.summary.totalGroups).toBe(0);
    expect(result.summary.totalDupRows).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.blastRadius).toEqual([]);
  });

  it('returns empty groups for a single row with no dup', async () => {
    const { svc } = await buildService(
      () => [row({ id: 1, name: 'Lone Game', igdbId: 42 })],
      [],
    );
    const result = await svc.runAudit();
    expect(result.summary.totalGames).toBe(1);
    expect(result.summary.totalGroups).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.blastRadius).toEqual([]);
  });

  it('detects an igdb-key dup pair and emits a group + blast radius row for the non-canonical id', async () => {
    // Two rows share igdbId=10. Row id=5 has itadGameId so it wins canonical.
    // Blast radius is computed for the LOSER (id=2) — 17 counts of zero suffice.
    const { svc } = await buildService(
      () => [
        row({ id: 5, name: 'Foo', igdbId: 10, itadGameId: 'itad-foo' }),
        row({ id: 2, name: 'Foo Alt', igdbId: 10 }),
      ],
      zeros(17),
    );
    const result = await svc.runAudit();
    expect(result.summary.totalGames).toBe(2);
    expect(result.summary.totalGroups).toBe(1);
    expect(result.summary.totalDupRows).toBe(1); // 2 in group - 1 canonical
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].canonicalId).toBe(5);
    expect(result.groups[0].dupIds).toEqual([2]);
    expect(result.groups[0].matchType).toBe('igdb');
    expect(result.groups[0].matchKey).toBe('10');
    expect(result.blastRadius).toHaveLength(1);
    expect(result.blastRadius[0].gameId).toBe(2);
  });

  it('detects a steam-key dup pair when igdbId is null on both rows', async () => {
    const { svc } = await buildService(
      () => [
        row({ id: 1, name: 'A', steamAppId: 777 }),
        row({ id: 2, name: 'B', steamAppId: 777 }),
      ],
      zeros(17),
    );
    const result = await svc.runAudit();
    expect(result.summary.totalGroups).toBe(1);
    expect(result.groups[0].matchType).toBe('steam');
    expect(result.groups[0].matchKey).toBe('777');
    expect(result.groups[0].canonicalId).toBe(1); // lowest id wins
  });

  it('detects a name-key dup pair when no igdb/steam keys match', async () => {
    const { svc } = await buildService(
      () => [
        row({ id: 30, name: 'Slay the Spire 2' }),
        row({ id: 31, name: 'Slay the Spire II' }),
      ],
      zeros(17),
    );
    const result = await svc.runAudit();
    expect(result.summary.totalGroups).toBe(1);
    expect(result.groups[0].matchType).toBe('name');
    expect(result.groups[0].matchKey).toMatch(/slay the spire 2/);
    expect(result.groups[0].canonicalId).toBe(30);
  });

  it('emits blast-radius counts populated from drizzle responses (per-table mapping)', async () => {
    // Two rows share igdbId=20. Canonical: id=1 (lower id). Loser: id=2.
    // ROK-1270 extends to 23 counts: 22 direct counts via buildDirectCountQueries
    // (16 ROK-1271 + 6 ROK-1270) then 1 JOIN count via countLineupMatchMembers.
    // Distinct non-zero values per slot — a destructure swap (e.g. events↔eventPlans
    // or tiebreakerBracketGameA↔tiebreakerBracketGameB) fails this test.
    const counts = [
      3, // events                       [direct 1]
      1, // eventPlans                   [direct 2]
      8, // lineupsDecided               [direct 3]
      2, // lineupEntries                [direct 4]
      4, // lineupMatches                [direct 5]
      9, // tiebreakers                  [direct 6]
      7, // characters                   [direct 7]
      10, // tasteVectors                 [direct 8]
      6, // interests                    [direct 9]
      11, // activityRollups              [direct 10]
      12, // activitySessions             [direct 11]
      13, // availability                 [direct 12]
      14, // channelBindings              [direct 13]
      15, // discordMappings              [direct 14]
      16, // eventTypes                   [direct 15]
      17, // interestSuppressions         [direct 16]
      18, // tiebreakerBracketGameA       [direct 17 — ROK-1270]
      19, // tiebreakerBracketGameB       [direct 18 — ROK-1270]
      20, // tiebreakerBracketWinner      [direct 19 — ROK-1270]
      21, // tiebreakerBracketVotes       [direct 20 — ROK-1270]
      22, // tiebreakerVetoes             [direct 21 — ROK-1270]
      23, // playerIntensitySnapshots     [direct 22 — ROK-1270]
      5, // lineupMatchMembers           [JOIN via execute()]
    ];
    const { svc } = await buildService(
      () => [
        row({ id: 1, name: 'A', igdbId: 20 }),
        row({ id: 2, name: 'B', igdbId: 20 }),
      ],
      counts,
    );
    const result = await svc.runAudit();
    expect(result.blastRadius).toHaveLength(1);
    const br = result.blastRadius[0];
    expect(br.gameId).toBe(2);
    expect(br.events).toBe(3);
    expect(br.eventPlans).toBe(1);
    expect(br.lineupsDecided).toBe(8);
    expect(br.lineupEntries).toBe(2);
    expect(br.lineupMatches).toBe(4);
    expect(br.tiebreakers).toBe(9);
    expect(br.characters).toBe(7);
    expect(br.tasteVectors).toBe(10);
    expect(br.interests).toBe(6);
    expect(br.activityRollups).toBe(11);
    expect(br.activitySessions).toBe(12);
    expect(br.availability).toBe(13);
    expect(br.channelBindings).toBe(14);
    expect(br.discordMappings).toBe(15);
    expect(br.eventTypes).toBe(16);
    expect(br.interestSuppressions).toBe(17);
    expect(br.tiebreakerBracketGameA).toBe(18);
    expect(br.tiebreakerBracketGameB).toBe(19);
    expect(br.tiebreakerBracketWinner).toBe(20);
    expect(br.tiebreakerBracketVotes).toBe(21);
    expect(br.tiebreakerVetoes).toBe(22);
    expect(br.playerIntensitySnapshots).toBe(23);
    expect(br.lineupMatchMembers).toBe(5);
  });

  it('sorts groups by totalDupRows DESC then by group size DESC', async () => {
    // Three groups: group A=4 rows (3 dups), group B=2 rows (1 dup),
    // group C=3 rows (2 dups). Expected order: A (3 dups), C (2 dups), B (1).
    const rows: GameRow[] = [
      row({ id: 1, name: 'A1', igdbId: 100 }),
      row({ id: 2, name: 'A2', igdbId: 100 }),
      row({ id: 3, name: 'A3', igdbId: 100 }),
      row({ id: 4, name: 'A4', igdbId: 100 }),
      row({ id: 5, name: 'B1', igdbId: 200 }),
      row({ id: 6, name: 'B2', igdbId: 200 }),
      row({ id: 7, name: 'C1', igdbId: 300 }),
      row({ id: 8, name: 'C2', igdbId: 300 }),
      row({ id: 9, name: 'C3', igdbId: 300 }),
    ];
    // 3 + 1 + 2 = 6 losers; 6 * 23 = 138 zero counts (22 direct + 1 JOIN per id).
    const { svc } = await buildService(() => rows, zeros(138));
    const result = await svc.runAudit();
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0].matchKey).toBe('100'); // A
    expect(result.groups[1].matchKey).toBe('300'); // C
    expect(result.groups[2].matchKey).toBe('200'); // B
  });
});

// ============================================================================
// ROK-1270 — persistSnapshot() — focused mock test that TRUNCATE precedes
// INSERT inside a single db.transaction call. The full integration coverage
// lives in games-dedup-audit.integration.spec.ts (real Postgres); this test
// only asserts the call-order invariant of the transaction body.
// ============================================================================
describe('GamesDedupAuditService.persistSnapshot', () => {
  it('issues TRUNCATE before INSERT inside a single transaction', async () => {
    const operations: string[] = [];

    // Loader returns one igdb-key dup pair. We exercise persistSnapshot, but
    // we want to capture the ORDER of writes inside the tx callback — not
    // the read-side mechanics, which the runAudit suite above already covers.
    const gameRows: GameRow[] = [
      {
        id: 1,
        name: 'A',
        slug: 'a',
        igdbId: 99,
        itadGameId: null,
        steamAppId: null,
        cachedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 2,
        name: 'B',
        slug: 'b',
        igdbId: 99,
        itadGameId: null,
        steamAppId: null,
        cachedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    // 23 zero counts (22 direct + 1 JOIN) for the single loser id=2,
    // plus 9 zero unique-conflict counts (composite ×8 + single-column ×1).
    let executeIdx = 0;
    const readCounts = Array.from<number>({ length: 23 }).fill(0);
    const readUniqueConflicts = Array.from<number>({ length: 9 }).fill(0);

    const tx = {
      execute: jest.fn(() => {
        operations.push('truncate');
        return Promise.resolve([{ c: 0 }]);
      }),
      insert: jest.fn(() => ({
        values: jest.fn(() => {
          operations.push('insert');
          return Promise.resolve(undefined);
        }),
      })),
    };

    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => {
            const v = readCounts[executeIdx] ?? 0;
            executeIdx += 1;
            return Promise.resolve([{ c: v }]);
          }),
          then: (resolve: (v: GameRow[]) => unknown) =>
            Promise.resolve(gameRows).then(resolve),
        })),
      })),
      execute: jest.fn(() => {
        const v = readUniqueConflicts.shift() ?? 0;
        return Promise.resolve([{ c: v }]);
      }),
      transaction: jest.fn(async (fn: (tx: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        GamesDedupAuditService,
        {
          provide: DrizzleAsyncProvider,
          useValue: db,
        },
      ],
    }).compile();
    const svc = module.get(GamesDedupAuditService);

    const summary = await svc.persistSnapshot();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(['truncate', 'insert']);
    expect(summary.totalGroups).toBe(1);
    expect(summary.totalDupRows).toBe(1);
    expect(summary.byStrategy).toEqual({ igdb: 1, steam: 0, name: 0 });
    expect(typeof summary.snapshotAt).toBe('string');
  });
});
