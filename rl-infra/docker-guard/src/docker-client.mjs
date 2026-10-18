// ROK-1846 — minimal Docker Engine client over the unix socket (lookups only).
import http from 'node:http';

export function dockerJson(socketPath, method, path) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, method, path, headers: { Host: 'docker' } }, (res) => {
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
    req.end();
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
 * Which runner slot is calling? Match the peer IP against the rl.role=runner
 * containers' network addresses. Null when the caller is not a runner — the
 * guard then refuses every mutating call (fail closed).
 */
export async function runnerForAddress(socketPath, address) {
  const ip = String(address ?? '').replace(/^::ffff:/, '');
  if (!ip) return null;
  const filters = encodeURIComponent(JSON.stringify({ label: ['rl.role=runner'] }));
  const { status, json } = await dockerJson(socketPath, 'GET', `/containers/json?filters=${filters}`);
  if (status !== 200 || !Array.isArray(json)) return null;
  for (const c of json) {
    const nets = c?.NetworkSettings?.Networks ?? {};
    const hit = Object.values(nets).some((n) => n && n.IPAddress === ip);
    const slot = c?.Labels?.['rl.slot'];
    if (hit && typeof slot === 'string' && /^[0-9]+$/.test(slot)) return { owner: `slot-${slot}`, slot };
  }
  return null;
}
