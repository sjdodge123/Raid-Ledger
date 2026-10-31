// ROK-1846 R6 — forward exactly the container / network the owner check saw.
// Docker resolves a container or network ref by full ID, then exact name, then
// a unique ID prefix, and it does so again when it handles the forwarded call.
// A runner can name its own container with a victim's ID prefix (all hex), pass
// the owner check (the inspect finds the runner's container by name), delete
// it, and the forwarded ref would land on the victim. So the guard forwards the
// FULL ID its inspect returned, which nothing can shadow. Volumes resolve by
// exact name only and exec instances by exact ID only (generated, never named),
// so their refs are forwarded as spelled. Pure.
const FULL_ID = /^[0-9a-f]{64}$/;
const COLLECTION = { container: 'containers', network: 'networks' };

/** Does `kind` need its ref pinned to the inspected full ID? */
export function pinsById(kind) {
  return Object.hasOwn(COLLECTION, kind);
}

/** The ID to forward for an owned object, or null when the inspect gave no usable full ID. */
export function pinnedRef(kind, ref, inspectedId) {
  if (!pinsById(kind)) return ref;
  return typeof inspectedId === 'string' && FULL_ID.test(inspectedId) ? inspectedId : null;
}

/** Rewrite the `/containers/{ref}` or `/networks/{ref}` path segment of a raw URL to `id`. */
export function pinPathRef(rawUrl, kind, id) {
  const coll = COLLECTION[kind];
  if (!coll) return String(rawUrl);
  return String(rawUrl).replace(new RegExp(`^((?:/v[0-9.]+)?/${coll}/)[^/?]+`), (_, head) => `${head}${id}`);
}
