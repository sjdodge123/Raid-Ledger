// ROK-2171 — remove the image a finished /build moved a reclaimable tag off.
//
// validate-ci's container check runs `docker build -t rl:ci-test` on every gate
// whose diff touches container files. Under the classic builder the previous
// `rl:ci-test` (~2 GB of layers) loses its name and lingers as a dangling image
// until the gc-sweeper's dangling_prune rung reaches it (6 h). The guard sees
// every runner build, so it snapshots the tag's image ID before forwarding and,
// once the build response finished and the tag points at a NEW image, deletes
// the old one. Safety, each a "keep" with a log line, never an error:
//   - another build is in flight through the guard (the old image's layers may
//     be its classic-builder cache parent) — checked again right before DELETE;
//   - the old image still carries ANY tag after the move (fix M1: Docker's
//     DELETE by ID, without force, still removes an image that has exactly one
//     other tag — e.g. an env image built `-t rl:ci-test -t …/rl-allinone:<slug>`
//     and not spun yet);
//   - the old image carries `rl.role=runner`;
//   - any container (running or stopped) was created from it, or that list is
//     unreadable;
//   - the daemon refuses the DELETE (no `force`, so Docker's own 409 checks for
//     containers and child images still apply).
// Nothing here can fail the build: the response is already sent. The snapshot
// before the build is bounded by the snapshot timeout; on a timeout or daemon
// error the build goes ahead and nothing is reclaimed after it.
import { dockerJson } from './docker-client.mjs';
import { parseImageRef } from './image-refs.mjs';

/** Normalised names (image-refs.mjs) whose predecessor the guard removes. */
export const RECLAIM_TAGS = new Set(['docker.io/library/rl:ci-test']);
const RUNNER_ROLE = 'runner';

const DEFAULT_SNAPSHOT_TIMEOUT_MS = 4000;
const DEFAULT_DELETE_TIMEOUT_MS = 60000;
/** A positive timeout, else `def` (a negative or non-numeric env value is ignored). */
function positiveMs(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}
let snapshotTimeoutMs = positiveMs(process.env.RL_GUARD_RECLAIM_SNAPSHOT_TIMEOUT_MS, DEFAULT_SNAPSHOT_TIMEOUT_MS);
// Fix 3: how long a removal DELETE (and so every build waiting on it) may take.
// A bounded wait is preferred over waiting forever: once it fires, a later build
// may overlap a DELETE Docker is still finishing, which at worst makes that build
// re-pull or rebuild layers (a cache miss), whereas one stalled cleanup with no
// bound would wedge every later guarded build on the runner indefinitely.
let deleteTimeoutMs = positiveMs(process.env.RL_GUARD_RECLAIM_DELETE_TIMEOUT_MS, DEFAULT_DELETE_TIMEOUT_MS);
let inFlight = 0;
let settled = Promise.resolve();
// Codex P2 + fix 3: every DELETE in progress (each may recursively remove
// untagged cache parents). Concurrent reclamations each add one; beginBuild()
// waits for ALL of them, and each leaves the set only once it has settled.
const deletions = new Set();

/** Builds the guard is currently forwarding (for tests). */
export function buildsInFlight() {
  return inFlight;
}

/** Override the snapshot timeout (tests); a non-positive value restores the default. */
export function setSnapshotTimeoutMs(ms) {
  snapshotTimeoutMs = positiveMs(ms, DEFAULT_SNAPSHOT_TIMEOUT_MS);
}

/** Override the removal DELETE timeout (tests); a non-positive value restores the default. */
export function setDeleteTimeoutMs(ms) {
  deleteTimeoutMs = positiveMs(ms, DEFAULT_DELETE_TIMEOUT_MS);
}

/** The timeouts in effect (tests). */
export function reclaimTimeouts() {
  return { snapshotMs: snapshotTimeoutMs, deleteMs: deleteTimeoutMs };
}

/** Resolves once the most recent post-build removal attempt has finished (for tests). */
export function reclaimSettled() {
  return settled;
}

function reclaimableTag(tags) {
  for (const t of tags) {
    const ref = parseImageRef(t);
    if (ref && !ref.digest && RECLAIM_TAGS.has(`${ref.name}:${ref.tag}`)) return t;
  }
  return null;
}

async function imageInfo(socket, ref, opts) {
  const { status, json } = await dockerJson(socket, 'GET', `/images/${encodeURIComponent(ref)}/json`, undefined, opts);
  if (status !== 200 || typeof json?.Id !== 'string') return { status, info: null };
  const tags = Array.isArray(json.RepoTags) ? json.RepoTags.filter((t) => typeof t === 'string' && t !== '<none>:<none>') : [];
  return { status, info: { id: json.Id, labels: json?.Config?.Labels ?? {}, tags } };
}

/** Containers of any state created from `id`; null when the list is unreadable. */
async function containersUsing(socket, id) {
  const filters = encodeURIComponent(JSON.stringify({ ancestor: [id] }));
  const { status, json } = await dockerJson(socket, 'GET', `/containers/json?all=1&filters=${filters}`);
  return status === 200 && Array.isArray(json) ? json.length : null;
}

async function removePrevious(socket, tag, oldId, log) {
  const kept = (why) => log(`RECLAIM kept previous ${tag} ${oldId}: ${why}`);
  const busy = () => `${inFlight} other build(s) in flight (dangling_prune reclaims it)`;
  const now = (await imageInfo(socket, tag)).info;
  if (now === null || now.id === oldId) return; // build failed or produced the same image
  if (inFlight > 0) return kept(busy());
  const old = (await imageInfo(socket, oldId)).info;
  if (old === null) return; // already gone
  if (old.tags.length > 0) return kept(`still tagged ${old.tags.join(', ')}`);
  if (old.labels['rl.role'] === RUNNER_ROLE) return kept('labelled rl.role=runner');
  const users = await containersUsing(socket, oldId);
  if (users === null) return kept('container list unreadable');
  if (users > 0) return kept(`${users} container(s) use it`);
  // Delta-review minor: a tag added during the checks above keeps the image.
  const last = (await imageInfo(socket, oldId)).info;
  if (last === null) return;
  if (last.tags.length > 0) return kept(`still tagged ${last.tags.join(', ')}`);
  if (inFlight > 0) return kept(busy()); // m3: a build may have started during the checks
  // No await between the check above and adding to `deletions`: any build that
  // begins after the check waits in beginBuild() until the DELETE has finished
  // or timed out (status 0, see deleteTimeoutMs).
  const del = dockerJson(socket, 'DELETE', `/images/${encodeURIComponent(oldId)}`, undefined, { timeoutMs: deleteTimeoutMs });
  const done = del.then(() => {}, () => {}).finally(() => deletions.delete(done));
  deletions.add(done);
  const { status, json } = await del;
  if (status === 200) return log(`RECLAIM removed previous ${tag} ${oldId}`);
  if (status === 0) return kept(`DELETE unanswered after ${deleteTimeoutMs} ms (timeout or daemon error; dangling_prune reclaims it)`);
  kept(`DELETE ${status} ${json?.message ?? ''}`.trimEnd());
}

/** The tag's current image ID, or null (absent, timed out, unreadable — then nothing is reclaimed). */
async function snapshot(socket, tag, log) {
  const { status, info } = await imageInfo(socket, tag, { timeoutMs: snapshotTimeoutMs });
  if (status === 0) log(`RECLAIM snapshot of ${tag} unavailable (timeout or daemon error): nothing reclaimed after this build`);
  return info?.id ?? null;
}

/**
 * Call before forwarding a /build; it counts the build in flight synchronously.
 * Resolves to `end(finished)`, to call when the guard's response closes
 * (`finished`: it completed); repeat calls are no-ops, so the count drops once.
 * It resolves only after every removal already dispatched has finished or timed
 * out, so a new build never runs alongside a DELETE (Codex P2, fix 3).
 */
export async function beginBuild(socket, tags, log) {
  inFlight += 1;
  let tag = null;
  let oldId = null;
  try {
    await Promise.all([...deletions]); // Codex P2 + fix 3: wait out EVERY removal in progress
    tag = reclaimableTag(tags ?? []);
    if (tag !== null) oldId = await snapshot(socket, tag, log);
  } catch (e) {
    log(`RECLAIM snapshot failed: ${e.message}`);
  }
  let ended = false;
  return function end(finished) {
    if (ended) return settled;
    ended = true;
    inFlight -= 1;
    if (!finished || tag === null || oldId === null) return settled;
    settled = removePrevious(socket, tag, oldId, log).catch((e) => log(`RECLAIM kept previous ${tag} ${oldId}: ${e.message}`));
    return settled;
  };
}
