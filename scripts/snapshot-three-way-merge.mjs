/**
 * Three-way merge of Drizzle snapshot JSON, for renumber-branch-migrations.mjs
 * (TECH-DEBT 2026-10-23 ×2: a renumbered snapshot kept a body that predated
 * main's new migrations, so `validate-migrations.sh --drift-only` failed with
 * "Snapshot drift: schema.ts differs from the latest snapshot").
 *
 * `fork` is the last snapshot at the branch's merge-base with main, `main` is
 * main's last snapshot, `branch` is one of the branch's snapshots. Whatever
 * main changed since the fork (a new table, a new column, a dropped index) is
 * applied to the branch snapshot unless the branch changed the same key too —
 * then the branch value is kept and the key path is reported as a conflict.
 * `id` and `prevId` always stay the branch's (the caller repoints prevId).
 */
const KEEP_BRANCH = new Set(['id', 'prevId']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
}

/** Deep equality that ignores object key order (undefined equals undefined). */
export const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function mergeValue(fork, main, branch, at, conflicts) {
  if (sameJson(main, fork) || sameJson(branch, main)) return branch;
  if (sameJson(branch, fork)) return main;
  if (isObj(main) && isObj(branch)) return mergeObject(isObj(fork) ? fork : {}, main, branch, at, conflicts);
  conflicts.push(at.join('.'));
  return branch;
}

/** Branch keys first (their order kept), then keys only main has. Undefined = deleted. */
function mergeObject(fork, main, branch, at, conflicts) {
  const out = {};
  for (const k of new Set([...Object.keys(branch), ...Object.keys(main)])) {
    const v = KEEP_BRANCH.has(k) && at.length === 0
      ? branch[k]
      : mergeValue(fork[k], main[k], branch[k], [...at, k], conflicts);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** @returns {{ snapshot: object, conflicts: string[] }} */
export function mergeSnapshot(fork, main, branch) {
  const conflicts = [];
  const snapshot = mergeObject(fork, main, branch, [], conflicts);
  return { snapshot, conflicts };
}
