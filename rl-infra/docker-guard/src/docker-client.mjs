// ROK-1846 — minimal Docker Engine client over the unix socket (lookups only).
import http from 'node:http';

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

/** Labels of a container / volume / network, or null when it cannot be read. */
export async function resourceLabels(socketPath, kind, id) {
  const entry = LABEL_PATH[kind];
  if (!entry || !id) return null;
  const [path, pick] = entry(id);
  const { status, json } = await dockerJson(socketPath, 'GET', path);
  if (status !== 200) return null;
  const labels = pick(json);
  return labels && typeof labels === 'object' ? labels : {};
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
 * compose service name AND the compose container_name `rl-runner-N`, which the
 * guard never lets a runner claim (routes.mjs) and whose compose labels it
 * never lets a runner set or inherit (body-policy.mjs). rl.slot must agree.
 */
export function composeRunnerSlot(c) {
  const labels = c?.Labels ?? {};
  const svc = /^runner-([0-9]+)$/.exec(String(labels['com.docker.compose.service'] ?? ''));
  const slot = svc?.[1];
  if (!slot || !labels['com.docker.compose.project']) return null;
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
  const filters = encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.service'] }));
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
