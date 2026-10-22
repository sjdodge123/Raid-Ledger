#!/usr/bin/env node
// The `validate-ci.sh --scoped` selector (operator ruling 2026-10-22).
//
// The pre-push sentinel used to need a full `--static` gate — build + tsc +
// lint for EVERY workspace, ~4-5 min of heavy work on a memory-fragile VM —
// even for a smoke-spec-only change. GitHub CI re-runs all of it before the
// merge anyway. `--scoped` runs build + tsc + lint ONLY for what the diff
// touches, and REFUSES (naming the tier to use instead) whenever the diff
// carries one of CLAUDE.md's escalation signals.
//
// Input: changed paths (repo-relative), one per line, on stdin.
// Output: exit 0 + the space-separated targets on stdout (`none` when nothing
// needs checking); exit 3 + the refusal on stderr when --scoped is not enough.
//
// Targets: api | web | smoke (scripts/smoke/tsconfig.typecheck.json) |
// scripts (shell parse + scripts/*.spec.mjs) | tool:<name> (tools/<name>).

/** Signals that need the full local suite — CLAUDE.md "Escalate to --full". */
const ESCALATE = [
  { re: /^packages\/contract\//, why: 'packages/contract/** (an additive change runs --static, a breaking one --full)', use: '--static' },
  { re: /(^|\/)drizzle\/migrations\//, why: 'a migration', use: '--full' },
  { re: /(^|\/)package(-lock)?\.json$/, why: 'package*.json (GitHub skips unit + integration for a deps-only change)', use: '--full' },
  { re: /(^|\/)Dockerfile[^/]*$|^nginx\/|(^|\/)docker-entrypoint[^/]*$/, why: 'Dockerfile / nginx / entrypoint (infra)', use: '--full' },
];

/** Root config every workspace reads — a narrowed gate cannot vouch for it. */
const SHARED_CONFIG = /^(tsconfig[^/]*\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*|\.prettierrc[^/]*|vitest\.config\.[^/]+)$/;

/** Paths no build, typecheck or lint step reads. */
const IGNORED = [
  /^docs\//,
  /^planning-artifacts\//,
  /^\.claude\//,
  /^\.codex\//,
  /^\.github\//,
  /^rl-infra\//,
  /^\.mcp\.json$/,
  /^\.gitignore$/,
  /\.md$/,
];

/** The target one path maps to, or null when it is not a known surface. */
function targetFor(path) {
  if (/^api\//.test(path)) return 'api';
  // The bundle budget only runs for a web target, so its own config maps there.
  if (/^web\//.test(path) || /^scripts\/(bundle-budget\.config|check-bundle-size)\.mjs$/.test(path)) return 'web';
  if (/^scripts\/smoke\/.*\.sh$/.test(path)) return 'scripts';
  // Everything else under scripts/smoke/ (tsconfig, fixtures, helper .mjs) feeds the smoke tsconfig.
  if (/^playwright\.config\.[^/]+$/.test(path) || /^scripts\/smoke\//.test(path) || /^scripts\/.*\.ts$/.test(path)) return 'smoke';
  // ci.yml is read by scripts/validate-ci-smoke-ci-parity.spec.mjs.
  if (/^scripts\//.test(path) || /^\.github\/workflows\//.test(path)) return 'scripts';
  const tool = /^tools\/([\w-]+)\//.exec(path);
  return tool ? `tool:${tool[1]}` : null;
}

/** @returns {{ok: false, reason: string, use: string}} */
function refuse(reason, use) {
  return { ok: false, reason, use };
}

/**
 * Plan a `--scoped` gate for a set of changed paths.
 *
 * @param {string[]} files - Repo-relative changed paths (blank lines ignored).
 * @returns {{ok: true, targets: string[]} | {ok: false, reason: string, use: string}}
 */
export function planScopedGate(files) {
  const paths = [...new Set(files.map((f) => f.trim()).filter(Boolean))];
  for (const path of paths) {
    const hit = ESCALATE.find((e) => e.re.test(path));
    if (hit) return refuse(`${path} touches ${hit.why}`, hit.use);
  }
  const targets = new Set();
  for (const path of paths) {
    if (SHARED_CONFIG.test(path)) return refuse(`${path} is root config every workspace reads`, '--static');
    const target = targetFor(path);
    if (target) targets.add(target);
    else if (!IGNORED.some((re) => re.test(path))) {
      return refuse(`${path} is outside every surface --scoped knows`, '--static');
    }
  }
  if (targets.has('api') && targets.has('web')) {
    return refuse('the diff crosses the api and web workspaces', '--static');
  }
  return { ok: true, targets: [...targets].sort() };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const plan = planScopedGate(input.split('\n'));
  if (!plan.ok) {
    process.stderr.write(`--scoped refused: ${plan.reason}. Run validate-ci.sh ${plan.use} instead.\n`);
    process.exit(3);
  }
  process.stdout.write(`${plan.targets.length ? plan.targets.join(' ') : 'none'}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
