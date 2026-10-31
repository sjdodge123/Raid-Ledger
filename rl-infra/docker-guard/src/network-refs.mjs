// ROK-1846 r11 — the forbidden-network check by IDENTITY, not by spelling.
// Docker resolves a network reference (HostConfig.NetworkMode, each
// NetworkingConfig.EndpointsConfig key, an endpoint's NetworkID, a
// /networks/{id}/connect target) by full ID, by name, or by a unique ID prefix
// (daemon.FindNetwork). GET /networks is allowed, so a runner can read the
// guard network's ID and name it in hex: a name-only regex never sees
// `docker-guard`. Each reference is resolved through the same daemon lookup and
// refused by the resolved Name; a reference that does not resolve is refused
// (fail closed).
import { dockerJson } from './docker-client.mjs';
import { FORBIDDEN_NET } from './host-config-allow.mjs';

// Docker's predefined modes that are not network objects to look up
// (`docker network create default` is refused by the daemon).
const NOT_A_NETWORK = new Set(['', 'default', 'none']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function addRef(refs, v) {
  if (typeof v === 'string' && !NOT_A_NETWORK.has(v)) refs.add(v);
}

/** Every network a container-create body names. */
export function containerCreateNetworkRefs(body) {
  const refs = new Set();
  addRef(refs, isObj(body?.HostConfig) ? body.HostConfig.NetworkMode : undefined);
  const nc = isObj(body?.NetworkingConfig) ? body.NetworkingConfig : {};
  const eps = isObj(nc.EndpointsConfig) ? nc.EndpointsConfig : {};
  for (const [key, ep] of Object.entries(eps)) {
    addRef(refs, key);
    if (isObj(ep)) addRef(refs, ep.NetworkID);
  }
  return [...refs];
}

/** Every network a /networks/{id}/(dis)connect call names. */
export function connectNetworkRefs(urlId, body) {
  const refs = new Set();
  addRef(refs, urlId);
  const ep = isObj(body) && isObj(body.EndpointConfig) ? body.EndpointConfig : {};
  addRef(refs, ep.NetworkID);
  return [...refs];
}

const FULL_ID = /^[0-9a-f]{64}$/;

/**
 * Resolve every reference once, through the daemon. { reason } to refuse, or
 * { ids } (ref → the full network ID) when each resolves to a network a runner
 * child may join. The caller forwards those IDs, not the refs (network-pin.mjs):
 * Docker re-resolves a stored ref at container start (ROK-1846 R5 M2).
 */
export async function resolveNetworkRefs(socketPath, refs) {
  const ids = new Map();
  for (const ref of refs) {
    if (FORBIDDEN_NET.test(ref)) return { reason: `network ${ref} is not allowed` };
    const { status, json } = await dockerJson(socketPath, 'GET', `/networks/${encodeURIComponent(ref)}`);
    const name = isObj(json) ? json.Name : undefined;
    const id = isObj(json) ? json.Id : undefined;
    if (status !== 200 || typeof name !== 'string' || name === '' || typeof id !== 'string' || !FULL_ID.test(id)) {
      return { reason: `network ${ref} could not be resolved` };
    }
    if (FORBIDDEN_NET.test(name)) return { reason: `network ${ref} resolves to ${name}, which is not allowed` };
    ids.set(ref, id);
  }
  return { ids };
}
