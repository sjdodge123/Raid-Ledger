// ROK-1846 — minimal Docker Engine client over the unix socket (lookups only).
import http from 'node:http';
import { COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL, INFRA_PROJECT } from './infra-project.mjs';

export function dockerJson(socketPath, method, path, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = payload ? { Host: 'docker', 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : { Host: 'docker' };
    const req = http.request({ socketPath, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.end(payload ?? undefined);
  });
}

const LABEL_PATH = {
  container: (id) => [`/containers/${encodeURIComponent(id)}/json`, (j) => j?.Config?.Labels],
  volume: (id) => [`/volumes/${encodeURIComponent(id)}`, (j) => j?.Labels],
  network: (id) => [`/networks/${encodeURIComponent(id)}`, (j) => j?.Labels],
};

/** Labels of a container / volume / network / exec, or null when it cannot be read. */
export async function resourceLabels(socketPath, kind, id) {
  return (await resourceInfo(socketPath, kind, id))?.labels ?? null;
}

/**
 * { labels, id } of a container / volume / network / exec, or null when it
 * cannot be read. `id` is the daemon's own `Id` for what the ref resolved to
 * (ROK-1846 R6: the guard forwards that, not the ref); an exec's is the ref.
 */
export async function resourceInfo(socketPath, kind, id) {
  if (kind === 'exec') {
    const labels = await execLabels(socketPath, id);
    return labels === null ? null : { labels, id };
  }
  const entry = LABEL_PATH[kind];
  if (!entry || !id) return null;
  const [path, pick] = entry(id);
  const { status, json } = await dockerJson(socketPath, 'GET', path);
  if (status !== 200) return null;
  const labels = pick(json);
  return { labels: labels && typeof labels === 'object' ? labels : {}, id: json?.Id };
}

/** An exec carries no labels of its own: ownership is its container's. */
async function execLabels(socketPath, id) {
  if (!id) return null;
  const { status, json } = await dockerJson(socketPath, 'GET', `/exec/${encodeURIComponent(id)}/json`);
  const containerId = status === 200 ? json?.ContainerID : undefined;
  if (typeof containerId !== 'string' || containerId === '') return null;
  return resourceLabels(socketPath, 'container', containerId);
}

/**
 * True when the named volume belongs to `owner`. An absent volume is created
 * here first, stamped with the owner labels (Docker would otherwise auto-create
 * it unlabelled on container create). An existing volume someone else owns —
 * or nobody owns — is refused by the caller.
 */
export async function ensureOwnedVolume(socketPath, name, owner, ownerLabel) {
  let labels = await resourceLabels(socketPath, 'volume', name);
  if (labels === null) {
    const created = await dockerJson(socketPath, 'POST', '/volumes/create', {
      Name: name, Labels: { [ownerLabel]: owner.owner, 'rl.slot': owner.slot },
    });
    if (created.status !== 201 && created.status !== 200) return false;
    labels = await resourceLabels(socketPath, 'volume', name);
  }
  return labels !== null && labels[ownerLabel] === owner.owner;
}

/**
 * The slot a compose-created runner container serves, or null. Labels alone
 * can be inherited from an image (a classic-builder RUN container of
 * `FROM rl-infra/runner` + `LABEL rl.slot=2`), so the slot comes from the
 * compose service name, the INFRA compose project (RL_COMPOSE_PROJECT) AND the
 * compose container_name `rl-runner-N`. The guard never lets a runner claim
 * that name (routes.mjs) nor set or inherit that project (body-policy.mjs); a
 * runner's own compose project may use any service name. rl.slot must agree.
 */
export function composeRunnerSlot(c, project = INFRA_PROJECT) {
  const labels = c?.Labels ?? {};
  const svc = /^runner-([0-9]+)$/.exec(String(labels[COMPOSE_SERVICE_LABEL] ?? ''));
  const slot = svc?.[1];
  if (!slot || labels[COMPOSE_PROJECT_LABEL] !== project) return null;
  if (!Array.isArray(c?.Names) || !c.Names.includes(`/rl-runner-${slot}`)) return null;
  if (labels['rl.slot'] !== undefined && labels['rl.slot'] !== slot) return null;
  return slot;
}

/**
 * Which runner slot is calling? Match the peer IP against the compose runner
 * containers' network addresses. Null when the caller is not a runner — the
 * guard then refuses every mutating call (fail closed).
 */
export async function runnerForAddress(socketPath, address) {
  const ip = String(address ?? '').replace(/^::ffff:/, '');
  if (!ip) return null;
  const filters = encodeURIComponent(JSON.stringify({ label: [COMPOSE_SERVICE_LABEL] }));
  const { status, json } = await dockerJson(socketPath, 'GET', `/containers/json?filters=${filters}`);
  if (status !== 200 || !Array.isArray(json)) return null;
  for (const c of json) {
    const nets = c?.NetworkSettings?.Networks ?? {};
    const hit = Object.values(nets).some((n) => n && n.IPAddress === ip);
    const slot = hit ? composeRunnerSlot(c) : null;
    if (slot) return { owner: `slot-${slot}`, slot };
  }
  return null;
}
