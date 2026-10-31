// ROK-1846 R5 M2 — forward exactly the networks the guard checked. Docker stores
// a container's network refs as spelled and re-resolves them at start (full ID,
// then exact name, then unique ID prefix), so a ref checked by NAME can mean
// another network by the time the container starts. Every ref the guard
// resolved (network-refs.mjs) is rewritten to its full ID, which nothing can
// shadow. Docker's predefined `bridge` stays as spelled: it cannot be created,
// deleted or shadowed, and the daemon treats the literal name specially. Pure.
const KEEP = new Set(['bridge']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function pinner(ids) {
  return (ref) => (typeof ref === 'string' && !KEEP.has(ref) && ids.has(ref) ? ids.get(ref) : ref);
}

function pinEndpoint(ep, pin) {
  return isObj(ep) && typeof ep.NetworkID === 'string' && ep.NetworkID !== '' ? { ...ep, NetworkID: pin(ep.NetworkID) } : ep;
}

/** { reason } or { body } with NetworkMode, EndpointsConfig keys and endpoint NetworkIDs pinned. */
export function pinContainerCreate(body, ids) {
  const pin = pinner(ids);
  const out = { ...body };
  if (isObj(body.HostConfig) && typeof body.HostConfig.NetworkMode === 'string') {
    out.HostConfig = { ...body.HostConfig, NetworkMode: pin(body.HostConfig.NetworkMode) };
  }
  const nc = body.NetworkingConfig;
  if (!isObj(nc) || !isObj(nc.EndpointsConfig)) return { body: out };
  const eps = {};
  for (const [key, ep] of Object.entries(nc.EndpointsConfig)) {
    const id = pin(key);
    if (Object.hasOwn(eps, id)) return { reason: `two endpoints name network ${id}` };
    eps[id] = pinEndpoint(ep, pin);
  }
  out.NetworkingConfig = { ...nc, EndpointsConfig: eps };
  return { body: out };
}

/** The (dis)connect URL and body, with the URL network and EndpointConfig.NetworkID pinned. */
export function pinConnect(rawUrl, urlId, body, ids) {
  const pin = pinner(ids);
  const url = String(rawUrl).replace(/^((?:\/v[0-9.]+)?\/networks\/)[^/?]+/, (_, head) => `${head}${encodeURIComponent(pin(urlId))}`);
  if (!isObj(body) || !isObj(body.EndpointConfig)) return { url, body };
  return { url, body: { ...body, EndpointConfig: pinEndpoint(body.EndpointConfig, pin) } };
}
