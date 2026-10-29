// ROK-1846 — the infra compose project. Its compose labels (service runner-N,
// project <this>) are half of how the guard recognises a runner
// (docker-client.mjs), and `docker volume prune` on the VM spares volumes
// labelled with it (orchestrator/bin/_disk_pressure.sh). A runner may run its
// own `docker compose` projects, but never under this name.
export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
export const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
export const INFRA_PROJECT = String(process.env.RL_COMPOSE_PROJECT || 'rl-infra').trim().toLowerCase();

/** Why a runner may not create a resource in compose project `v`, or null. */
export function composeProjectReason(v) {
  if (typeof v !== 'string' || v.trim() === '') return `compose labels need a non-empty ${COMPOSE_PROJECT_LABEL}`;
  const p = v.trim().toLowerCase();
  if (p === INFRA_PROJECT || p.startsWith('rl-infra')) return `compose project ${v} is reserved for the fleet infra`;
  return null;
}
