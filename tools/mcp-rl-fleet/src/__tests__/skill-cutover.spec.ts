// ROK-1331 M5b — hard cutover verification.
//
// Every callsite of `rl claim` / `rl_claim` in skills + CLAUDE.md must
// either (a) reference the new `{enqueued, queue_position}` response shape
// and the `rl_claim_wait` companion, or (b) be a historical comment.
//
// This test greps the implementation files (NOT planning-artifacts/) and
// fails when any callsite still documents the OLD 409-on-held semantic
// without mentioning the queue / enqueue shape.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// Repo root = three levels up from this file (tools/mcp-rl-fleet/src/__tests__).
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

function gitGrep(pattern: string, paths: string[]): string[] {
  try {
    const out = execSync(`git grep -nE '${pattern}' -- ${paths.map((p) => `'${p}'`).join(' ')}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return out.split('\n').filter(Boolean);
  } catch (err: unknown) {
    // git grep exits 1 when no matches found — treat as empty list.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return (e.stdout ?? '').split('\n').filter(Boolean);
    throw err;
  }
}

describe('M5b skill cutover — rl_claim queue semantic in all callsites', () => {
  it('every rl_claim / rl claim reference in .claude/skills/** mentions the new queue contract OR rl_claim_wait', () => {
    const lines = gitGrep('rl[_ ]claim', ['.claude/skills/']);
    // Allow lines that:
    //   - mention "enqueue", "queue_position", "queued", "rl_claim_wait", "queue:"
    //   - are inside a comment about historical/old behavior (prefixed by "historical" or "legacy")
    //   - are file paths in tables explaining cross-references (table separators)
    const offenders = lines.filter((line) => {
      const lc = line.toLowerCase();
      if (/enqueue|queue_position|queued|rl_claim_wait|queue:|queues|inherited_envs/.test(lc)) return false;
      if (/historical|legacy|old (shape|contract|behaviour|behavior)|previously/.test(lc)) return false;
      return true;
    });
    expect(offenders, `skill files mention rl_claim WITHOUT queue semantics:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('CLAUDE.md rl_claim references mention queue / enqueue semantics', () => {
    const lines = gitGrep('rl[_ ]claim', ['CLAUDE.md']);
    const offenders = lines.filter((line) => {
      const lc = line.toLowerCase();
      if (/enqueue|queue_position|queued|rl_claim_wait|inherited_envs/.test(lc)) return false;
      if (/historical|legacy|previously/.test(lc)) return false;
      // The STRICT block enumerating tools that accept worktree_path is allowed
      // to list `rl_claim` without the queue language IF the same line lists
      // siblings like rl_release/rl_env_spin (that pattern is about identity
      // resolution, not contract).
      if (/rl_release.*rl_env_spin|rl_env_spin.*rl_release/.test(line)) return false;
      return true;
    });
    expect(offenders, `CLAUDE.md mentions rl_claim WITHOUT queue semantics:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the unscoped `rl claim --branch unknown` / `rl_claim --branch unknown` shape is GONE', () => {
    // Phrasing that ONLY appears in pre-M5b skill text: "Acquire a runner slot
    // on the rl-infra VM. ... Idempotent — returns existing slot if this agent
    // already holds one." (the pre-M5b CLAUDE.md row). After cutover, this
    // sentence must be replaced.
    const lines = gitGrep(
      'Idempotent — returns existing slot if this agent already holds one',
      ['CLAUDE.md', '.claude/skills/'],
    );
    expect(lines, 'pre-M5b CLAUDE.md rl_claim description still present').toEqual([]);
  });

  it('handover + step-5-ship document that rl_release preserves child envs by default', () => {
    // AC-skill-cutover-release-default.
    const handover = gitGrep('preserve.envs|preserve.envs|preserves.*child.envs', [
      '.claude/skills/handover/SKILL.md',
    ]);
    const ship = gitGrep('preserve.envs|preserves.*child.envs|destroy_envs', [
      '.claude/skills/build/steps/step-5-ship.md',
    ]);
    expect(handover.length, 'handover skill must mention preserve-envs default').toBeGreaterThan(0);
    expect(ship.length, 'step-5-ship must mention preserve-envs/destroy_envs default').toBeGreaterThan(0);
  });

  it('reviewer-gated grep across full implementation surface returns zero stale callsites', () => {
    // Final pass — matches the spec's `git grep -nE 'rl[_ ]claim' -- ':!*.lock' ':!planning-artifacts/'`.
    // Allowed callsites must mention queue / wait language. This is the union
    // of the per-file assertions above, scoped to production files only.
    const lines = gitGrep('rl[_ ]claim', [
      '.claude/skills/',
      'CLAUDE.md',
      'rl-infra/cli/',
      'tools/mcp-rl-fleet/',
    ]).filter((line) => {
      // Exclude the test file itself, which intentionally contains the phrase.
      return !line.includes('skill-cutover.spec.ts');
    });
    const offenders = lines.filter((line) => {
      const lc = line.toLowerCase();
      if (/enqueue|queue_position|queued|rl_claim_wait|queue:|queues|inherited_envs/.test(lc)) return false;
      if (/historical|legacy|previously/.test(lc)) return false;
      if (/rl_release.*rl_env_spin|rl_env_spin.*rl_release/.test(line)) return false;
      // Function/variable names in source code (rl_claim as a TS export) are fine.
      if (/export (const|function|async function) (rl_)?claim|TOOL_NAME = ['"]rl_claim['"]/.test(line)) return false;
      // Imports from `./tools/claim.js` are fine.
      if (/import \* as claim from/.test(line)) return false;
      return true;
    });
    expect(offenders, `production callsites of rl_claim missing queue semantics:\n${offenders.join('\n')}`).toEqual([]);
  });
});
