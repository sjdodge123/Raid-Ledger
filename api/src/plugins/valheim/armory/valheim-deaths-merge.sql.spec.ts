/**
 * ROK-1941 SQL B, widened by ROK-1931: a log death also merges into a
 * reported (`mod`) death and keeps its position + character key. Rendered
 * SQL only; the real-DB behaviour is the integration spec's.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { logDeathMergeSql } from './valheim-deaths-merge.sql';

const dialect = new PgDialect();

function render() {
  const q = dialect.sqlToQuery(
    logDeathMergeSql(
      3,
      {
        characterName: 'Ragnar',
        steamId: '76561198000000001',
        loggedAt: '2026-10-17T20:05:10',
        occurredAt: new Date('2026-10-17T20:05:10Z'),
      },
      120,
    ),
  );
  return { text: q.sql.replace(/\s+/g, ' '), params: q.params };
}

/** The `merged` CTE's SET list, between `SET` and `FROM cand`. */
function setList(text: string): string {
  const m = /UPDATE valheim_player_deaths d SET (.*?) FROM cand/.exec(text);
  if (!m?.[1]) throw new Error(`no merged SET in: ${text}`);
  return m[1];
}

describe('logDeathMergeSql (SQL B, ROK-1931 widening)', () => {
  it('takes any discord death, or an unlogged mod death, as the merge candidate', () => {
    // A discord death inferred from a screenshot carries logged_at (linkSql);
    // excluding it double-counts the death when its log line arrives (Codex P1).
    const { text } = render();
    expect(text).toContain(
      "d.source IN ('discord', 'mod') AND (d.source = 'discord' OR d.logged_at IS NULL)",
    );
  });

  it('turns the merged row into a log row and leaves the reported fields alone', () => {
    const set = setList(render().text);
    expect(set).toContain("source = 'log'");
    expect(set).not.toMatch(/reported_at|player_id|world_uid|\bx =|\bz =/);
  });

  it('never takes a candidate attributed to another SteamID (D6)', () => {
    const { text, params } = render();
    expect(text).toMatch(
      /d\.steam_id IS NULL OR \$\d+::text IS NULL\s+OR d\.steam_id = \$\d+::text/,
    );
    expect(params).toContain('76561198000000001');
  });

  it('keeps the log dedupe key and the 120 s window', () => {
    const { text, params } = render();
    expect(text).toContain(
      "ON CONFLICT (pelican_server_id, character_name, logged_at) WHERE source = 'log' DO NOTHING",
    );
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM existing)');
    expect(params).toContain(120);
  });
});
