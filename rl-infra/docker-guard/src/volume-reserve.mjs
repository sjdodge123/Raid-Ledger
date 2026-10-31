// ROK-1846 c6 — volume names a runner may never create or mount.
//
// env-spin mounts `rl-data-<slug>` as an env's PostgreSQL data dir, and the
// compose project `rl-infra` owns `rl-infra_*` (traefik-acme, registry-data,
// the runners' node_modules / cache). If a runner could create one of those
// names before the orchestrator does — through POST /volumes/create or a named
// volume in a containers/create body (the guard pre-creates it owner-stamped)
// — it would keep ownership of a volume a live env or infra service later
// adopts. The orchestrator never creates these through the guard, so no
// runner owns them: they are refused outright. Pure.

const RESERVED_VOLUME = /^(rl-data-|rl-infra_)/;

/** Refusal reason for a reserved volume name, or null. */
export function reservedVolumeReason(name) {
  if (typeof name !== 'string' || !RESERVED_VOLUME.test(name)) return null;
  return `volume name ${name} is reserved for fleet envs / infra (rl-data-*, rl-infra_*)`;
}
