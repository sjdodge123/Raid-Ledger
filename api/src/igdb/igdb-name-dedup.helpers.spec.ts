/**
 * Unit tests for normalized-name dedup helpers (ROK-1113).
 *
 * Covers:
 * - findGameByNormalizedName: token prefilter + JS post-filter, no/exact match,
 *   Roman/Arabic match, token-count parity guard.
 * - findGameIdsByNormalizedName: batch path uses one SELECT.
 * - findDuplicateGroupsByNormalizedName: groups dupes; mixed-igdbId groups go
 *   to `skipped` (GTA V case).
 * - pickNameGroupWinner: priority order.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  findGameByNormalizedName,
  findGameIdsByNormalizedName,
  findDuplicateGroupsByNormalizedName,
  pickNameGroupWinner,
} from './igdb-name-dedup.helpers';

interface RowFixture {
  id: number;
  name: string;
  igdbId: number | null;
  steamAppId: number | null;
  itadGameId: string | null;
}

function row(
  id: number,
  name: string,
  overrides: Partial<RowFixture> = {},
): RowFixture {
  return {
    id,
    name,
    igdbId: null,
    steamAppId: null,
    itadGameId: null,
    ...overrides,
  };
}

// ─── findGameByNormalizedName ────────────────────────────────────────────

describe('findGameByNormalizedName', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns null when input has no significant token', async () => {
    const result = await findGameByNormalizedName(mockDb as never, '');
    expect(result).toBeNull();
    // No SQL issued
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns null when prefilter yields no candidates', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    const result = await findGameByNormalizedName(mockDb as never, 'Halo');
    expect(result).toBeNull();
  });

  it('matches a row whose normalized name equals the input', async () => {
    mockDb.where.mockResolvedValueOnce([
      row(7, 'Slay the Spire II', { igdbId: 9001 }),
    ]);
    const result = await findGameByNormalizedName(
      mockDb as never,
      'Slay the Spire 2',
    );
    expect(result?.id).toBe(7);
  });

  it('matches a row exact-name (no roman conversion needed)', async () => {
    mockDb.where.mockResolvedValueOnce([row(11, 'Halo Infinite')]);
    const result = await findGameByNormalizedName(
      mockDb as never,
      'Halo Infinite',
    );
    expect(result?.id).toBe(11);
  });

  it('returns null for token-count mismatch (Doom vs Doom: Eternal)', async () => {
    // Prefilter returns "Doom: Eternal" because lower(name) LIKE '%doom%'
    mockDb.where.mockResolvedValueOnce([
      row(20, 'Doom: Eternal', { igdbId: 555 }),
    ]);
    const result = await findGameByNormalizedName(mockDb as never, 'Doom');
    expect(result).toBeNull();
  });

  it('returns null when no candidate normalized-name matches input', async () => {
    mockDb.where.mockResolvedValueOnce([row(33, 'Halo Reach')]);
    const result = await findGameByNormalizedName(
      mockDb as never,
      'Halo Infinite',
    );
    expect(result).toBeNull();
  });

  it('issues a single SELECT with an ILIKE prefilter', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    await findGameByNormalizedName(mockDb as never, 'Slay the Spire 2');
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });
});

// ─── findGameIdsByNormalizedName (batch) ─────────────────────────────────

describe('findGameIdsByNormalizedName', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns empty map when given no names', async () => {
    const result = await findGameIdsByNormalizedName(mockDb as never, []);
    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('uses ONE SELECT for many names (batched)', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    await findGameIdsByNormalizedName(mockDb as never, [
      'Slay the Spire 2',
      'Halo Infinite',
      'Doom Eternal',
    ]);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it('maps Roman numeral variants to existing rows', async () => {
    // Existing DB row uses Roman numerals; ingest sees Arabic
    mockDb.where.mockResolvedValueOnce([
      row(7, 'Slay the Spire II', { igdbId: 9001 }),
    ]);
    const result = await findGameIdsByNormalizedName(mockDb as never, [
      'Slay the Spire 2',
    ]);
    expect(result.get('slay the spire 2')).toEqual({ id: 7, igdbId: 9001 });
  });

  it('skips rows whose token count differs (Doom vs Doom: Eternal)', async () => {
    mockDb.where.mockResolvedValueOnce([
      row(20, 'Doom: Eternal', { igdbId: 555 }),
    ]);
    const result = await findGameIdsByNormalizedName(mockDb as never, ['Doom']);
    expect(result.has('doom')).toBe(false);
  });
});

// ─── findDuplicateGroupsByNormalizedName ─────────────────────────────────

describe('findDuplicateGroupsByNormalizedName', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns size-1 groups as no-op (no duplicates)', async () => {
    mockDb.from.mockResolvedValueOnce([row(1, 'Halo Infinite')]);
    const { groups, skipped } = await findDuplicateGroupsByNormalizedName(
      mockDb as never,
    );
    expect(groups).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('groups Roman/Arabic variants of the same canonical game', async () => {
    mockDb.from.mockResolvedValueOnce([
      row(1, 'Slay the Spire II', { igdbId: 9001 }),
      row(2, 'Slay the Spire 2'),
    ]);
    const { groups, skipped } = await findDuplicateGroupsByNormalizedName(
      mockDb as never,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedName).toBe('slay the spire 2');
    expect(groups[0].rows.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(skipped).toEqual([]);
  });

  it('does NOT collide rows with different token counts', async () => {
    mockDb.from.mockResolvedValueOnce([
      row(1, 'Doom'),
      row(2, 'Doom: Eternal'),
    ]);
    const { groups } = await findDuplicateGroupsByNormalizedName(
      mockDb as never,
    );
    expect(groups).toEqual([]);
  });

  it('routes mixed-igdbId groups to `skipped` (GTA V case)', async () => {
    mockDb.from.mockResolvedValueOnce([
      row(1, 'Grand Theft Auto V', { igdbId: 1001 }),
      row(2, 'Grand Theft Auto 5', { igdbId: 1002 }), // different IGDB id — sequel/remake
    ]);
    const { groups, skipped } = await findDuplicateGroupsByNormalizedName(
      mockDb as never,
    );
    expect(groups).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].rows.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('keeps groups with one igdbId + nulls (manual/ITAD-only entries)', async () => {
    mockDb.from.mockResolvedValueOnce([
      row(1, 'Slay the Spire 2', { igdbId: 9001 }),
      row(2, 'Slay the Spire II'), // null igdbId
    ]);
    const { groups, skipped } = await findDuplicateGroupsByNormalizedName(
      mockDb as never,
    );
    expect(groups).toHaveLength(1);
    expect(skipped).toEqual([]);
  });
});

// ─── pickNameGroupWinner ─────────────────────────────────────────────────

describe('pickNameGroupWinner', () => {
  it('prefers the row with both igdbId AND itadGameId', () => {
    const winner = pickNameGroupWinner([
      row(2, 'X', { igdbId: 100 }),
      row(3, 'X', { itadGameId: 'abc' }),
      row(4, 'X', { igdbId: 200, itadGameId: 'def' }),
      row(5, 'X'),
    ]);
    expect(winner.id).toBe(4);
  });

  it('falls back to row with igdbId when no full row exists', () => {
    const winner = pickNameGroupWinner([
      row(2, 'X', { itadGameId: 'abc' }),
      row(3, 'X', { igdbId: 100 }),
      row(5, 'X'),
    ]);
    expect(winner.id).toBe(3);
  });

  it('falls back to row with itadGameId when no igdbId rows exist', () => {
    const winner = pickNameGroupWinner([
      row(2, 'X', { steamAppId: 555 }),
      row(3, 'X', { itadGameId: 'abc' }),
      row(5, 'X'),
    ]);
    expect(winner.id).toBe(3);
  });

  it('falls back to steamAppId when no igdbId/itadGameId rows exist', () => {
    const winner = pickNameGroupWinner([
      row(7, 'X'),
      row(2, 'X', { steamAppId: 555 }),
    ]);
    expect(winner.id).toBe(2);
  });

  it('falls back to lowest id when no other signal exists', () => {
    const winner = pickNameGroupWinner([row(7, 'X'), row(2, 'X'), row(5, 'X')]);
    expect(winner.id).toBe(2);
  });
});
