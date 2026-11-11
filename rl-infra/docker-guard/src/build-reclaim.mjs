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
//     be its classic-builder cache parent);
//   - the old image carries `rl.role=runner`;
//   - any container (running or stopped) was created from it, or that list is
//     unreadable;
//   - the daemon refuses the DELETE (no `force`, so Docker's own 409 checks for
//     containers and child images still apply).
// Nothing here can fail the build: the response is already sent.
import { dockerJson } from './docker-client.mjs';
import { parseImageRef } from './image-refs.mjs';

/** Normalised names (image-refs.mjs) whose predecessor the guard removes. */
export const RECLAIM_TAGS = new Set(['docker.io/library/rl:ci-test']);
const RUNNER_ROLE = 'runner';

let inFlight = 0;
let settled = Promise.resolve();

/** Builds the guard is currently forwarding (for tests). */
export function buildsInFlight() {
  return inFlight;
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

async function imageInfo(socket, ref) {
  const { status, json } = await dockerJson(socket, 'GET', `/images/${encodeURIComponent(ref)}/json`);
  if (status !== 200 || typeof json?.Id !== 'string') return null;
  return { id: json.Id, labels: json?.Config?.Labels ?? {} };
}

/** Containers of any state created from `id`; null when the list is unreadable. */
async function containersUsing(socket, id) {
  const filters = encodeURIComponent(JSON.stringify({ ancestor: [id] }));
  const { status, json } = await dockerJson(socket, 'GET', `/containers/json?all=1&filters=${filters}`);
  return status === 200 && Array.isArray(json) ? json.length : null;
}

async function removePrevious(socket, tag, oldId, log) {
  const now = await imageInfo(socket, tag);
  if (now === null || now.id === oldId) return; // build failed or produced the same image
  if (inFlight > 0) return log(`RECLAIM kept previous ${tag} ${oldId}: ${inFlight} other build(s) in flight (dangling_prune reclaims it)`);
  const old = await imageInfo(socket, oldId);
  if (old === null) return; // already gone
  if (old.labels['rl.role'] === RUNNER_ROLE) return log(`RECLAIM kept previous ${tag} ${oldId}: labelled rl.role=runner`);
  const users = await containersUsing(socket, oldId);
  if (users === null) return log(`RECLAIM kept previous ${tag} ${oldId}: container list unreadable`);
  if (users > 0) return log(`RECLAIM kept previous ${tag} ${oldId}: ${users} container(s) use it`);
  const { status, json } = await dockerJson(socket, 'DELETE', `/images/${encodeURIComponent(oldId)}`);
  if (status === 200) return log(`RECLAIM removed previous ${tag} ${oldId}`);
  log(`RECLAIM kept previous ${tag} ${oldId}: DELETE ${status} ${json?.message ?? ''}`.trimEnd());
}

/**
 * Call before forwarding a /build. Returns `end(finished)`, to call exactly once
 * when the guard's response closes; `finished` is true when it completed.
 */
export async function beginBuild(socket, tags, log) {
  inFlight += 1;
  let tag = null;
  let oldId = null;
  try {
    tag = reclaimableTag(tags ?? []);
    if (tag !== null) oldId = (await imageInfo(socket, tag))?.id ?? null;
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
