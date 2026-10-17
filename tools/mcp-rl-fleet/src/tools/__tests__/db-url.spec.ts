// ROK-1338 PR-3 (A4) — rl_db_url result-shape regression.
//
// Pure metadata tool — no SSH stubbing required. Pins the post-PR-3 shape:
//   - back-compat `psql_exec_cmd` still emitted (will be removed next cycle).
//   - new `psql_exec_cmd_operator` mirrors the legacy field exactly.
//   - new `mcp_query_hint` advertises rl_db_query for agent-side reads.
//   - third notes[] entry mentions operator-only + rl_db_query.

import { describe, it, expect } from 'vitest';
import { execute } from '../db-url.js';

describe('rl_db_url — ROK-1338 PR-3 A4 surface', () => {
  it('returns both psql_exec_cmd (back-compat) and psql_exec_cmd_operator', async () => {
    const r = await execute({ slug: 'myslug' });
    expect(r.ok).toBe(true);
    expect(r.psql_exec_cmd).toBeDefined();
    expect(r.psql_exec_cmd_operator).toBeDefined();
    // The two fields are aliases for one cycle — exact-equal value.
    expect(r.psql_exec_cmd).toBe(r.psql_exec_cmd_operator);
    // Both still encode the literal SSH command the operator runs from
    // their shell. Agents do not invoke this string.
    expect(r.psql_exec_cmd_operator).toContain('ssh rl-infra docker exec');
    expect(r.psql_exec_cmd_operator).toContain('rl-env-myslug-pg');
  });

  it('returns mcp_query_hint pointing at rl_db_query', async () => {
    const r = await execute({ slug: 'myslug' });
    expect(r.mcp_query_hint).toBeDefined();
    expect(r.mcp_query_hint).toMatch(/rl_db_query/);
    expect(r.mcp_query_hint).toMatch(/read-only/i);
  });

  it('third notes[] entry mentions operator-only AND rl_db_query', async () => {
    const r = await execute({ slug: 'myslug' });
    expect(r.notes.length).toBeGreaterThanOrEqual(3);
    const third = r.notes[2];
    expect(third).toMatch(/operator-only/);
    expect(third).toMatch(/rl_db_query/);
  });

  it('does not still advertise psql_exec_cmd as agent-runnable in notes', async () => {
    const r = await execute({ slug: 'myslug' });
    // The legacy "Run it from a terminal" note implied the agent runs it.
    // Now the third note explicitly says operator-only.
    const joined = r.notes.join(' | ');
    expect(joined).not.toMatch(/the psql_exec_cmd opens an interactive prompt on the VM\. Run it from a terminal\./);
  });
});
