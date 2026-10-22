// ROK-1846 — glue between the route plan and the body checkers. Pure.
import { checkContainerCreate, checkExecCreate, checkNetworkCreate, checkVolumeCreate } from './body-policy.mjs';
import { foldReason } from './key-fold.mjs';

// Docker reads Container case-insensitively (Go encoding/json), so
// {"Container":"owned","container":"victim"} would be owner-checked on one
// key and acted on by the other: every field Docker reads must be spelled once,
// exactly (key-fold.mjs).
function checkNetworkConnect(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'body is not a JSON object' };
  const fold = foldReason(body, ['Container', 'EndpointConfig', 'Force'], 'network-connect');
  return fold ? { ok: false, reason: fold } : { ok: true, body };
}

const CHECKERS = {
  'container-create': checkContainerCreate,
  'exec-create': (body) => checkExecCreate(body),
  'volume-create': checkVolumeCreate,
  'network-create': checkNetworkCreate,
  // The body names the container being (dis)connected; ownership of it is
  // checked by the server (see bodyOwnedContainer).
  'network-connect': checkNetworkConnect,
};

/** Run the named checker. ctx = { allow: string[], owner: { owner, slot } }. */
export function checkBody(name, body, ctx) {
  const fn = CHECKERS[name];
  if (!fn) return { ok: false, reason: `no checker named ${name}` };
  return fn(body, ctx);
}

/** For network connect/disconnect: the container named in the body. */
export function bodyOwnedContainer(name, body) {
  if (name !== 'network-connect') return null;
  const c = body && typeof body === 'object' ? body.Container : undefined;
  return typeof c === 'string' && c !== '' ? c : '';
}
