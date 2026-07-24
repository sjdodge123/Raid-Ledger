/**
 * Unit tests for the ROK-1418 suppression helpers (batch B1-1).
 *
 * These target the not-yet-created `ad-hoc-suppression.helpers.ts` module:
 *   - `planSuppressionExtension` — the pure extension planner (60m window /
 *     15m refresh threshold / 6h ceiling / never-backward).
 *   - `buildAnchoredGameClause` — the channel-scoped game-suppression clause.
 *
 * Until the dev creates that module every case here fails-by-construction (the
 * import cannot resolve). That is the expected TDD-RED state for B1-1.
 *
 * Regression: ROK-1418
 */
import {
  planSuppressionExtension,
  buildAnchoredGameClause,
  SUPPRESSION_WINDOW_MS,
  SUPPRESSION_REFRESH_THRESHOLD_MS,
  SUPPRESSION_MAX_EXTENSION_MS,
} from './ad-hoc-suppression.helpers';

/**
 * Recursively extract RAW string fragments from Drizzle SQL objects. Copied
 * verbatim from `ad-hoc-event.helpers.spec.ts:11-28` — NOTE it only surfaces
 * raw template text, NOT column references (`${tables.events.gameId}` renders
 * empty), so assertions below check raw tokens like `channel_type`.
 */
function sqlToString(obj: unknown, depth = 0): string {
  if (depth > 15 || !obj) return '';
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj))
    return obj.map((v) => sqlToString(v, depth + 1)).join('');
  const record = obj as Record<string, unknown>;
  if (record.value && Array.isArray(record.value)) {
    return (record.value as unknown[])
      .map((v) => sqlToString(v, depth + 1))
      .join('');
  }
  if (record.queryChunks && Array.isArray(record.queryChunks)) {
    return (record.queryChunks as unknown[])
      .map((v) => sqlToString(v, depth + 1))
      .join('');
  }
  return '';
}

describe('planSuppressionExtension (ROK-1418)', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');
  /** Minutes offset from `now`, as a Date. */
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('exposes the documented window/threshold/ceiling constants', () => {
    expect(SUPPRESSION_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(SUPPRESSION_REFRESH_THRESHOLD_MS).toBe(15 * 60 * 1000);
    expect(SUPPRESSION_MAX_EXTENSION_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('extends to now+1h when there is no current window (currentExtended null)', () => {
    // scheduledEnd 2h out ⇒ ceiling now+8h ⇒ target = min(now+1h, ceiling) = now+1h.
    const result = planSuppressionExtension(at(120), null, now);
    expect(result).toEqual({ action: 'extend', newEnd: at(60) });
  });

  it('skips a fresh window (currentExtended >= now+15m) → skip-fresh', () => {
    const result = planSuppressionExtension(at(120), at(40), now);
    expect(result).toEqual({ action: 'skip-fresh' });
  });

  it('extends when the current window is stale-ish (currentExtended < now+15m)', () => {
    // currentExtended now+5m is inside the 15m threshold ⇒ not fresh; target
    // now+1h is beyond it and below the ceiling ⇒ extend to now+1h.
    const result = planSuppressionExtension(at(120), at(5), now);
    expect(result).toEqual({ action: 'extend', newEnd: at(60) });
  });

  it('caps at the ceiling when the event ended long ago (target <= now) → skip-capped', () => {
    // scheduledEnd 7h ago ⇒ ceiling now-1h ⇒ target now-1h <= now ⇒ skip-capped.
    const result = planSuppressionExtension(at(-420), null, now);
    expect(result).toEqual({ action: 'skip-capped', ceiling: at(-60) });
  });

  it('never moves a far-future window backward — a naive impl would clobber to now+1h', () => {
    // ROK-576 clobber pin. currentExtended now+90m is fresh (>= now+15m), so
    // the planner must leave it alone rather than rewrite it to now+1h.
    const result = planSuppressionExtension(at(0), at(90), now);
    expect(result).toEqual({ action: 'skip-fresh' });
  });

  it('never advances past the ceiling even when the current window is not fresh → skip-capped', () => {
    // currentExtended now+10m is NOT fresh (< now+15m); scheduledEnd 5h50m ago
    // ⇒ ceiling now+10m ⇒ target = min(now+1h, now+10m) = now+10m, which is
    // <= currentExtended ⇒ skip-capped (no forward progress, no backward move).
    const result = planSuppressionExtension(at(-350), at(10), now);
    expect(result).toEqual({ action: 'skip-capped', ceiling: at(10) });
  });
});

describe('buildAnchoredGameClause (ROK-1418)', () => {
  it('is byte-identical to the bare game match when no channelId is given', () => {
    // Legacy 4-arg path: no channel-scoping subqueries are added.
    const sqlText = sqlToString(buildAnchoredGameClause(5));
    expect(sqlText).not.toContain('channel_bindings');
    expect(sqlText).not.toContain('channel_type');
    expect(sqlText).not.toContain('NOT EXISTS');
  });

  it('adds the ephemeral + series channel-scoping subqueries when channelId is given', () => {
    // The anchored clause excludes events demonstrably homed in a different
    // voice channel: an ephemeral-channel anchor + a series-binding anchor
    // (EXISTS voice binding for this channel, OR NOT EXISTS any voice binding).
    const sqlText = sqlToString(buildAnchoredGameClause(5, 'voice-channel-C'));
    expect(sqlText).toContain('channel_bindings');
    expect(sqlText).toContain('channel_type');
    expect(sqlText).toContain('NOT EXISTS');
  });
});
