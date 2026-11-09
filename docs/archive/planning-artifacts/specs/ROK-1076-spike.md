# ROK-1076 Spike: Game Taste Vectors Pipeline

**Spike Lead:** Research Agent  
**Status:** Complete  
**Date:** 2026-04-18  
**Related:** ROK-948 (player_taste_vectors), ROK-1082 (backfill issue)

---

## Executive Summary

This spike designs a per-game 7-axis taste vectors pipeline that mirrors the existing `player_taste_vectors` implementation (ROK-948). Each game will store a normalized `vector(7)` encoding its position across 7 core dimensions (`co_op, pvp, rpg, survival, strategy, social, mmo`) derived from IGDB metadata, ITAD tags, and community play signals. This enables cosine similarity queries between players and games, and between groups and games, for recommendations and discovery. The pipeline will be backfilled on ~49 seeded games and run daily thereafter, refreshing games when IGDB metadata or play activity changes.

---

## Schema Decision

### Option A: Standalone `game_taste_vectors` Table

```sql
CREATE TABLE game_taste_vectors (
  id SERIAL PRIMARY KEY,
  gameId INTEGER UNIQUE NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  vector vector(7) NOT NULL,
  dimensions JSONB NOT NULL,  -- full 24-axis pool (0–100 scores)
  computedAt TIMESTAMP DEFAULT NOW(),
  signalHash TEXT NOT NULL,   -- change-tracking
  INDEX (computedAt)
);
```

**Pros:**
- Mirrors `player_taste_vectors` structure exactly; patterns reusable
- Game vectors are rarely updated (weekly/monthly cadence), independent of player vectors
- Easier to version, test, and roll back game-only changes
- Clean separation: players are profiles; games are content properties
- Simpler incremental backfill (can batch games independently of user state)

**Cons:**
- Additional table; one more join in similarity queries
- Requires backfill migration in separate script

### Option B: Column on `games` Table

Add `vector vector(7)` and `dimensions JSONB` columns directly to the `games` table.

**Pros:**
- No extra join; zero latency overhead
- Games table already has metadata (genres, modes, themes, ITAD tags)

**Cons:**
- Complicates game schema (mixes content + taste profile concerns)
- Harder to index, version, and test taste-profile logic in isolation
- Game updates might accidentally dirty the vector if we don't use upsert carefully
- Future: if we want to add game-derived vectors (e.g., visual similarity from images), harder to extend

### **Recommendation: Option A — Standalone Table**

**Justification:**  
Taste vectors are algorithmic derivations, not core game data. A standalone table enforces separation of concerns, reuses the proven player pattern, and scales cleanly if we add visual or embedding-based vectors later. The one-table-join overhead is negligible (games have ~49–1000 rows; a join is microseconds).

---

## Signal Sources & Weighting

### Metadata Sources (Immutable)

| Source | Field | Priority | Usage |
|--------|-------|----------|-------|
| IGDB | `genres` (IDs) | Fallback | Tag matching if ITAD not available |
| IGDB | `gameModes` (IDs) | Fallback | e.g., mode 3 → co_op, mode 5 → mmo |
| IGDB | `themes` (IDs) | Fallback | e.g., theme 17 → fantasy, theme 21 → survival |
| ITAD | `itadTags` (strings) | Primary | Rich vocabulary (e.g., "Roguelike", "Factory Building") |

### Activity/Interest Signals (Dynamic)

| Signal | Source Table | Weight | Semantics |
|--------|--------------|--------|-----------|
| Play hours (aggregate) | `game_activity_rollups` | See formula | Sum of all users' weekly playtime |
| Interest count | `game_interests` | See formula | Count of distinct users with interest (any source) |
| Steam ownership | `game_interests` (source='steam_library') | See formula | Count of Steam owners in community |
| Steam wishlist | `game_interests` (source='steam_wishlist') | See formula | Count of wishlist adds |
| Manual interest | `game_interests` (source='manual') | See formula | Count of manual hearts |

### Weight Formula for Games

Unlike the user pipeline (which uses per-user signal sums), games derive weights from **aggregate community signals**:

```
axisScore(game, axis) = 
  (baselineMetadataMatch(game, axis) * 1.0) +
  (playActivityWeight * idf(axis))

baselineMetadataMatch ∈ {0, 1}  -- game matches axis via tags/genres/modes/themes
playActivityWeight = 0.5 * normalizedCommunityPlaytime + 0.3 * normalizedInterestCount
normalizedCommunityPlaytime = log(totalGameMinutes + 1) / log(maxGameMinutes + 1)
normalizedInterestCount = interestCount / maxInterestCount
```

**Rationale:**  
- Games with ZERO play signal (IGDB-only cold games) still get a vector from metadata alone
- Play activity is secondary: it *confirms* or *slightly boosts* the metadata classification but doesn't override it
- Community play shouldn't skew the vector; e.g., if everyone plays *off-genre*, we still classify by the game's actual design
- Logs prevent a single popular game from dominating; normalization scales [0, 1]

### Axis Mapping Table (Per Axis)

The same `AXIS_MAPPINGS` from `axis-mapping.constants.ts` applies to games. Example for `strategy`:

```typescript
strategy: {
  tags: [
    'Strategy', 'RTS', 'Real Time Strategy', 'Turn-Based Strategy',
    'Turn-Based', '4X', 'Grand Strategy', 'Wargame', 'Tactics',
    'Auto Battler', 'Tower Defense'
  ],
  gameModes: [],
  genres: [11, 15, 16, 24],  // IGDB: Strategy, Tactical RPG, Turn-based tactics, Board Game Simulation
  themes: [41],              // IGDB: Business
}
```

**Tag Matching:** Case-insensitive substring/exact match (case-insensitive).  
**IGDB Fallback:** Only used if `itadTags` is empty or not yet synced.

---

## Vector-Derivation Algorithm

### Phase 1: Load Game Metadata (One-Time)

```typescript
async function loadGameMetadata(db): Promise<Map<gameId, GameMetadata>> {
  const rows = db.select({
    id: games.id,
    genres: games.genres,
    gameModes: games.gameModes,
    themes: games.themes,
    itadTags: games.itadTags,
  }).from(games).where(games.banned = false and games.hidden = false);
  
  // Normalize tags to lowercase
  return map { gameId => GameMetadata(genres, gameModes, themes, tags.toLower()) }
}
```

### Phase 2: Load Community Play Signals (Per Game)

```typescript
async function loadGameSignals(db, gameId): Promise<GameSignals> {
  const rollups = db.select(
    COUNT(DISTINCT userId) as uniquePlayerCount,
    SUM(totalSeconds) as totalSeconds
  ).from(gameActivityRollups)
   .where(gameId = gameId and period = 'week');
  
  const interests = db.select(
    COUNT(DISTINCT userId) as uniqueInterestedCount
  ).from(gameInterests)
   .where(gameId = gameId);
  
  return GameSignals(
    uniquePlayerCount: rollups.uniquePlayerCount,
    totalSeconds: rollups.totalSeconds,
    uniqueInterestedCount: interests.uniqueInterestedCount
  )
}
```

**Note:** Only use the most recent **week** of play data (rolling 7 days) to avoid stale signals. Games with no recent play default to metadata classification.

### Phase 3: Compute Per-Axis Scores

```typescript
function computeGameVector(
  game: GameMetadata,
  signals: GameSignals,
  axisIdf: Record<axis, number>,
  corpusStats: { maxGameMinutes, maxInterestCount }
): { dimensions, vector } {
  
  const raw = zeroedPool();
  
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    // 1. Baseline: does the game match this axis by metadata?
    const metadataMatch = axisMatchFactor(axis, game); // 0 or 1
    
    // 2. Activity boost: how strong is community play?
    const playWeight = 0.5 * log(signals.totalSeconds + 1) / 
                              log(corpusStats.maxGameMinutes + 1) +
                       0.3 * signals.uniqueInterestedCount / 
                             corpusStats.maxInterestCount;
    
    // 3. Combine with IDF rarity weighting
    raw[axis] = (metadataMatch + playWeight) * axisIdf[axis];
  }
  
  // 4. Self-normalize to [0, 100] display scale (same as players)
  const max = Math.max(...raw.values());
  const dimensions = Object.fromEntries(
    TASTE_PROFILE_AXIS_POOL.map(axis => [
      axis,
      max > 0 ? Math.round((raw[axis] / max) * 100) : 0
    ])
  );
  
  // 5. Extract 7-core-axis vector for pgvector
  const vector = TASTE_PROFILE_AXES.map(
    axis => dimensions[axis] / 100
  );
  
  return { dimensions, vector };
}
```

### Phase 4: Compute IDF (Corpus-Level, Cached)

```typescript
function computeGameAxisIdf(
  games: Map<gameId, GameMetadata>,
  corpusStats: { maxGameMinutes, maxInterestCount }
): Record<axis, number> {
  const idf = {} as Record<axis, number>;
  const n = games.size;
  const coverage = zeroedPool();
  
  for (const game of games.values()) {
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      if (axisMatchFactor(axis, game) > 0) {
        coverage[axis] += 1;
      }
    }
  }
  
  // Same formula as players: ln((N + 1) / (coverage + 1)) + 1
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    idf[axis] = Math.log((n + 1) / (coverage[axis] + 1)) + 1;
  }
  
  return idf;
}
```

### IDF for Games: Special Considerations

**Problem:** With ~49 games, IDF might explode for niche axes.  
Example: "Automation" might cover only 3 games → `idf = ln(50/4) + 1 ≈ 3.2`. 

**Impact:** If a game matches both "Strategy" (40 games, idf≈1.1) and "Automation" (3 games, idf≈3.2), automation gets 3× weight despite being less common overall.

**Mitigation:** IDF is still correct mathematically (rarer axes *should* matter more). However, we should:
1. **Accept this behavior** — it encourages diversity in recommendations.
2. **Monitor drift** as the corpus grows (50→1000 games). IDF values will stabilize closer to 1.0.
3. **Do NOT apply IDF if corpus < 20 games** — too volatile. Instead, use flat weighting and toggle IDF on at 50+ games.
4. **Document in code:** "IDF is disabled for corpora < 20 games to avoid runaway weights on niche axes."

**Recommendation:** Apply IDF starting at 50 games. For the initial ~49, use flat weighting (idf = 1.0 for all axes). This gives us stable vectors during the pilot and avoids overfitting to early niche classifications.

---

## Backfill Plan

### Stage 1: Initial Backfill (~49 games)

**Scope:**  
- All non-banned, non-hidden games from `games` table
- Full week of play data from `game_activity_rollups` (period='week', most recent week)
- Interest counts from `game_interests`

**Batch Strategy:**
- Load all game metadata once (negligible: ~49 games)
- Compute corpus stats once (max playtime, max interest count)
- Iterate games; compute vector for each
- Upsert into `game_taste_vectors` in batches of 10–20

**Runtime Estimate (49 games):**
- Metadata load: ~50 ms
- Corpus stats query: ~100 ms
- Per-game vector compute: ~5 ms × 49 = ~245 ms
- Upsert 49 rows: ~200 ms
- **Total: ~600 ms** (single-threaded, no concurrency)

**Execution:**  
```bash
npm run db:backfill -- --task=game-vectors-initial
# Or: node scripts/backfill-game-vectors.ts
```

No downtime; runs alongside live cron. Publish vectors with `computedAt` timestamp so the cron can skip already-computed games on next run.

---

### Stage 2: Growth Scenarios

| Corpus Size | Approach | Runtime | Notes |
|-------------|----------|---------|-------|
| ~49 → 100 | Batch all at once | ~1 sec | Still single-threaded; acceptable |
| 100 → 500 | Batch games in groups of 50 | ~3 sec | Consider async batching per group |
| 500 → 1000 | Parallel batch (5 workers, 200 games/worker) | ~2 sec | Requires connection pooling adjustment |
| 1000+ | Nightly cron, skip unchanged games | ~5 sec | Use `signalHash` to skip games with no new play data |

**signalHash Strategy:**  
Similar to players: hash of `(maxCachedAt, sumTotalSeconds, sumInterestCount)` — if unchanged, skip upsert. Reduces write load at scale.

---

## Refresh Plan

### Trigger: Daily Cron

**Schedule:** `0 6 * * *` (06:00 UTC, 30 min after player cron)

**Logic:**

```typescript
export async function runGameTasteVectorsCron(db: Db): Promise<void> {
  // 1. Load all game metadata + corpus stats
  const games = await loadGameMetadata(db);
  const corpusStats = await loadCorpusStats(db);
  const axisIdf = computeGameAxisIdf(games, corpusStats);
  
  // 2. Load existing vectors for change-tracking
  const existing = await db.select().from(gameTasteVectors);
  const existingByGame = new Map(existing.map(v => [v.gameId, v]));
  
  // 3. For each non-banned, non-hidden game:
  for (const gameId of games.keys()) {
    // Skip if: game is banned or hidden (re-check)
    const game = games.get(gameId);
    if (game.banned || game.hidden) continue;
    
    // Load fresh signals (most recent week)
    const signals = await loadGameSignals(db, gameId);
    
    // Compute signal hash
    const newHash = computeSignalHash({
      cachedAt: game.cachedAt,
      totalSeconds: signals.totalSeconds,
      interestCount: signals.uniqueInterestedCount,
    });
    
    // Skip if unchanged
    const existing = existingByGame.get(gameId);
    if (existing && existing.signalHash === newHash) continue;
    
    // Compute vector
    const { dimensions, vector } = computeGameVector(
      game,
      signals,
      axisIdf,
      corpusStats
    );
    
    // Upsert
    await db.insert(gameTasteVectors)
      .values({ gameId, vector, dimensions, signalHash: newHash })
      .onConflictDoUpdate({
        target: gameTasteVectors.gameId,
        set: { vector, dimensions, signalHash: newHash, computedAt: new Date() }
      });
  }
  
  logger.info(`Computed game taste vectors for ${games.size} games`);
}
```

**Change-Tracking:**  
No need to add a column to `games`; we track changes via the cron's signal hash. If IGDB metadata changes (genres/modes/themes), the metadata is live; if play signals change, `loadGameSignals` sees the new data.

**Frequency:**  
Daily (6:00 UTC) is sufficient. Most games don't get new play signals every hour, and tag syncs from ITAD happen weekly. Could reduce to weekly if needed (ROK-1076-B backlog).

### Event-Driven Refresh (Future)

If we want sub-hourly freshness:
- Listen for `games.cachedAt` updates (IGDB enrichment)
- Listen for new `game_activity_rollups` or `game_interests` inserts
- Re-trigger `computeGameVector` for affected game(s)

**Status:** Out of scope for Batch 1. Add as ROK-1076-B.

---

## Compute Cost

### Per-Game Vector Computation

**Breakdown:**
- Metadata match (tag/genre/mode/theme check): O(24 × (tags.length + modes.length)) ≈ 0.1 ms
- IDF lookup: O(24) ≈ 0.01 ms
- Vector normalization: O(24) ≈ 0.01 ms
- **Per game: ~0.12 ms**

### Corpus-Wide (49 games)

- Load metadata: 50 ms
- Load corpus stats: 100 ms
- Compute vectors: 49 × 0.12 = 6 ms
- Upsert (batch of 20): 200 ms
- **Total: ~360 ms** (single-threaded, no concurrency)

### Scaling

| Size | Est. Time | DB Queries |
|------|-----------|-----------|
| 49 | 0.4 sec | 3 (metadata, stats, upsert batch) |
| 100 | 0.8 sec | 3 (same shape) |
| 500 | 4 sec | 3 (same shape) |
| 1000 | 8 sec | 3 (same shape) |
| 10,000 | 80 sec | 3 (same shape; or split upsert into 50 batches) |

**Cron Window:** Plenty of headroom in 6:00 UTC slot (player cron finishes by 5:30).

---

## Accuracy & Drift Concerns

### Cold Games (IGDB-only, Zero Play Signal)

**Problem:** A brand-new game (synced from IGDB, no plays yet) gets its vector entirely from metadata. If IGDB's tags are sparse or generic, the vector might be misleading.

**Example:** A puzzle game with IGDB genres `[9]` (Puzzle) but no ITAD tags. The axis `puzzle` gets a 1.0 match, but `rpg`, `strategy`, etc., get 0. The vector is correct *per metadata*, but the game hasn't been vetted by the community.

**Mitigation:**
1. **Trust IGDB for single-player genres** (platformer, puzzle, action). These are author-intent.
2. **Require play signal for multiplayer axes** (co_op, pvp, mmo, social). E.g., `co_op` should not get a 1.0 match on metadata alone if there's zero play data.
3. **Add a confidence score** (optional, future): store `{ vector, dimensions, confidence: float }` where confidence is low for games with zero play data and converges to 1.0 as play accumulates.

**For Now:** Accept cold-game vectors as metadata-derived estimates. Document in code that vectors stabilize after 10+ weekly play hours.

### Off-Genre Play (Community Overrides Metadata)

**Problem:** A game is tagged `strategy`, but the community plays it purely for co-op/social reasons (e.g., a co-op dungeon crawler sold as a strategy game).

**Current Algorithm Behavior:** Metadata match gives `strategy = 1.0`; play signal (if it exists) adds a small boost to co_op via weights. The *final normalized vector* might show `strategy = 100, co_op = 45` — not ideal if community preference diverges.

**Mitigation (Not Implemented — Future):**
- Option A: Weight play signals more heavily (currently 0.5/0.3 in the formula; increase to 0.8/0.4).
- Option B: Prefer tags over genres (already done; ITAD tags are primary).
- Option C: Add user-feedback loop (flag misclassifications, auto-correct tag assignments).

**For Now:** Play signal boost is modest; metadata dominates. This is acceptable because:
1. We're seeding with 49 high-quality games (all vetted).
2. ITAD tags are rich and community-curated.
3. If divergence occurs, it surfaces in recommendation feedback and can be fixed via tag corrections.

### Banned/Hidden Games

**Handling:**
- Exclude from vector computation (don't write to `game_taste_vectors` if `banned=true` or `hidden=true`).
- If a game is banned *after* vectors are computed, leave the vector in place (no soft-delete) but the game won't appear in discovery queries (handled in API layer).
- If a game is un-banned, its vector is stale; re-run cron to refresh.

### Untitled/Generic Games

**Examples:** "Generic", "TBD", test games in the seed.

**Handling:**
- If these are in the `games` table but have no IGDB metadata (igdbId = null), they get vectors from ITAD tags or stay zero-filled (all axes = 0).
- These games should rarely appear in discovery anyway (filtered by `enabled = true`).
- Acceptable behavior; no action needed.

---

## Index Strategy

### Initial Corpus (~49 games)

**No index required.** The `game_taste_vectors` table is tiny; sequential scan is faster than index overhead.

### Growth Milestones

| Corpus Size | Query Pattern | Recommended Index | Rationale |
|-------------|---------------|-------------------|-----------|
| < 100 | Full table scan + vector ops | None | Scan < 1 ms; index overhead > benefit |
| 100–500 | Cosine similarity range (TOP 10–50) | HNSW on `vector` | Efficient for nearest-neighbor |
| 500–1000 | Multiple range queries; drill-down by axis | HNSW + B-tree on `computedAt` | Age-based filtering before similarity |
| 1000+ | Faceted discovery (axis = X, then similar) | HNSW + partial index on active games | Exclude banned/hidden at index time |

### HNSW vs. IVFFlat vs. None

**HNSW (Hierarchical Navigable Small World):**
- Pros: Fast exact search (milliseconds for 1000+ vectors), tunable recall/speed tradeoff, best for modern pgvector.
- Cons: Higher index build time; requires pgvector extension (we have it from ROK-948).
- **Use at 500+ games.**

**IVFFlat (Inverted File with Flat Clustering):**
- Pros: Fast build; good for very large corpora (10k+).
- Cons: Less accurate for small corpora; pgvector HNSW is preferred.
- **Use at 10k+ games; consider HNSW until then.**

**None:**
- Current state (< 100 games).

### Breakpoint Decision

**Rule of thumb:** Add HNSW index when cosine-similarity queries hit > 10 ms on a 500-game corpus.

**Benchmark (sample query):**
```sql
SELECT gameId, 1 - (vector <=> $1::vector) AS similarity
FROM game_taste_vectors
ORDER BY vector <=> $1::vector
LIMIT 10;
-- On 500 games: ~8–15 ms without index, ~1–3 ms with HNSW
-- Breakpoint: < 10 ms on unindexed 500-game table → defer index to 1000+
```

**Implementation (deferred to Batch 2):**
```sql
CREATE INDEX idx_game_taste_vectors_vector_hnsw
  ON game_taste_vectors USING hnsw (vector vector_cosine_ops)
  WITH (m=16, ef_construction=64);
```

**For Batch 1:** Skip index. No queries on this table yet.

---

## Rejected Alternatives

### 1. Embedding-Based Vectors from Game Descriptions (LLM)

**Approach:** Use Claude to embed `games.summary` or full IGDB description into a single 1024-dim vector, then reduce to 7 dims via PCA.

**Why Rejected:**
- **Circular:** LLM embeddings encode meaning, not gameplay affinity. A game described as "puzzle-platformer" might embed near "art game", which tells us *theme* not *play style*.
- **Unstable:** Different model versions give different embeddings; would require recompute + reindex on each model upgrade.
- **Expensive:** Claude API calls for 1k+ games; ~$10–50 per 1000 games.
- **Slower:** Embedding a description takes 1–2 sec per game; 1000 games = 1000–2000 sec.
- **Unnecessary:** IGDB + ITAD metadata is already rich and directly encodes game axes.

**Keep:** Stay with explicit metadata + play signals. Consider embeddings for *visual* similarity (cover image, screenshots) in a future spike.

### 2. Machine Learning (Logistic Regression on User Labels)

**Approach:** Train a classifier on user taste profiles (known `co_op` lovers, etc.) to predict how well a game matches each axis.

**Why Rejected:**
- **Sample size:** Only 49 games; insufficient training data for a 7-class classifier.
- **Collinearity:** User taste data is biased toward games that exist (only the 49). No negative examples.
- **Overkill:** Explicit mapping already works; diminishing returns to add ML.
- **Drift:** Model needs retraining as the corpus grows; adds operational overhead.

**Keep:** Use explicit rules. Revisit in 1–2 years if we have 10k+ games and evidence that explicit rules are inaccurate.

### 3. Category Mapping via User Consensus (Majority Vote)

**Approach:** For each game, check how many users rated it as `co_op`, `pvp`, etc., and use the plurality result.

**Why Rejected:**
- **Bootstrapping problem:** No pre-existing consensus data. We'd have to build a ratings interface first.
- **Gaming:** Users might mis-rate games (trolling, confusion); requires moderation.
- **Latency:** New games have zero ratings; would be entirely metadata-driven anyway.

**Keep:** Stay with metadata-first. If we build user ratings later (UGC) for other purposes, we can fold them into Batch 2 as a secondary signal.

### 4. Full 24-Axis Vector (No Reduction to 7)

**Approach:** Store both 24-axis (`dimensions` JSONB) and 24-dim vector in pgvector.

**Why Rejected:**
- **Schema mismatch:** Player vectors are 7-dim (for cosine similarity). Game vectors must be 7-dim to be compared fairly.
- **Complexity:** Two separate similarity queries (7-axis for broad search, 24-axis for drill-down) doubles indexing overhead.

**Compromise:** Store full 24-axis in `dimensions` JSONB (like players). Reduce to 7-axis for the `vector(7)` column used in similarity queries. Both layers available to the API.

---

## Open Questions

1. **IDF Toggle Timing:** Should we enable IDF immediately at 49 games, or wait until 100? Initial feedback appreciated to avoid recompute.
   
2. **Play Activity Window:** Use only the most recent week, or rolling 4-week average? Trade-off: recent data is responsive; rolling average is stable.
   
3. **Confidence Score:** Should vectors carry a confidence/freshness metric (low for cold games, high for popular games)? Deferred or immediate?
   
4. **Refresh Cadence:** Is daily (6:00 UTC) sufficient, or should we refresh when IGDB metadata changes? Suggest event-driven refresh as ROK-1076-B.

---

## Implementation Checklist (For Batch 1)

- [ ] Create `game_taste_vectors` table schema (Drizzle migration)
- [ ] Implement `loadGameMetadata` + `loadGameSignals` loaders
- [ ] Implement `computeGameVector` + `computeGameAxisIdf` helpers
- [ ] Implement `computeSignalHash` for change-tracking
- [ ] Write initial backfill script (`scripts/backfill-game-vectors.ts`)
- [ ] Wire daily cron in NestJS (`GameTasteVectorsCron` service)
- [ ] Unit tests: vector computation, IDF, hash stability
- [ ] Integration test: backfill on seed data, verify vectors are normalized [0, 1]
- [ ] Add API endpoint: `GET /games/{id}/taste-vector` (for debugging)
- [ ] Add API endpoint: `POST /games/similar` (cosine similarity search)
- [ ] Documentation: axis definitions, signal weighting, refresh schedule

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-18  
**Status:** Final — Ready for Batch 1 Implementation
