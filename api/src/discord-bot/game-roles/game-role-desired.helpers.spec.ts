/**
 * ROK-1767 — shape guard for the shared "played" CTE. The behaviour is proven
 * against a real DB in `game-role-desired.integration.spec.ts`; this pins that
 * Quick Play participation stays one of the sources (operator ruling
 * 2026-10-15), since the removal-hint query reuses the same CTE.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { playedCte } from './game-role-desired.helpers';

const render = (): string =>
  new PgDialect()
    .sqlToQuery(playedCte(7, '2026-10-01T00:00:00Z', '2026-10-15T12:00:00Z'))
    .sql.replace(/\s+/g, ' ');

describe('playedCte sources (ROK-1767)', () => {
  it('unions presence, scheduled-event voice and Quick Play participation', () => {
    const q = render();

    expect(q).toContain('FROM game_activity_sessions s');
    expect(q).toContain('FROM event_voice_sessions v');
    expect(q).toContain('FROM ad_hoc_participants a');
  });

  it('counts only ad-hoc events with time in voice or still in, capped at the event end', () => {
    const q = render();

    expect(q).toContain('AND e.is_ad_hoc = true');
    expect(q).toContain(
      'AND (a.total_duration_seconds > 0 OR a.left_at IS NULL)',
    );
    expect(q).toContain('COALESCE(a.left_at, LEAST($');
    expect(q).toContain('COALESCE(e.extended_until, upper(e.duration))');
  });
});
