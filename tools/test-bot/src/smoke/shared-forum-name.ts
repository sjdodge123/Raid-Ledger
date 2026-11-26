/**
 * Pure naming rules for the run's shared hub forum (see
 * `tests/hub-forum-shared.ts`). No Discord, no API: unit-tested by
 * `shared-forum-name.spec.ts`.
 *
 * The name keeps the existing `rl-smoke-forum-<runId>` convention, where the
 * run id is `Date.now().toString(36)`, so a leftover's age is readable from
 * its name alone.
 */

const PREFIX = "rl-smoke-forum-";
const BASE36_ID = /^rl-smoke-forum-([0-9a-z]+)$/;

/**
 * A forum younger than this may belong to a live run on the shared guild (a
 * full smoke run takes ~40 min; two pool runs can overlap), so the sweep
 * leaves it alone.
 */
export const SHARED_FORUM_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** The shared forum's channel name for a run started at `nowMs`. */
export function sharedForumName(nowMs: number): string {
  return `${PREFIX}${nowMs.toString(36)}`;
}

/**
 * True only for an `rl-smoke-forum-<base36 ms>` forum older than
 * {@link SHARED_FORUM_MAX_AGE_MS}: the leftover of a run that died before its
 * teardown. Fails closed on any other name.
 */
export function isStaleSharedForum(name: string, nowMs: number): boolean {
  const id = BASE36_ID.exec(name)?.[1];
  if (id === undefined) return false;
  const createdMs = parseInt(id, 36);
  if (!Number.isSafeInteger(createdMs)) return false;
  return nowMs - createdMs > SHARED_FORUM_MAX_AGE_MS;
}
