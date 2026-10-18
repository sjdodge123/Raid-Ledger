// ROK-1846 — route table for the runner-facing Docker API guard.
//
// classify(method, url) returns a plan the server executes:
//   { ok: false, reason }                      → 403, never forwarded
//   { ok: true, body?: <checker>, owned?: {...} } → forwarded after the checks
// `body` names a checker in body-policy.mjs (the request body is buffered and
// validated / rewritten). `owned` names a resource the CALLER must own: the
// guard stamps rl.guard.owner on everything it creates, so infra containers
// (rl-gc-sweeper holds the raw socket), env containers and the other slots'
// containers are out of reach for exec / archive / kill / rm.
// Anything not listed is refused — the allowlist is the boundary.

import { buildTagReason, pullReason, pushReason, tagReason } from './image-refs.mjs';

const ID = '[A-Za-z0-9_.-]+';
const IMG = '[A-Za-z0-9_.@:/-]+';
const R = (method, pattern, plan) => ({ method, re: new RegExp(`^${pattern}$`), plan });

const ALLOW = {};
const ownedContainer = { owned: { kind: 'container', group: 1 } };

const ROUTES = [
  R('GET', '/(_ping|version|info|events)', ALLOW),
  R('HEAD', '/_ping', ALLOW),
  R('GET', '/containers/json', ALLOW),
  // Inspect / logs of another slot's or an env's container would hand a runner
  // its Env (Discord bot tokens, admin passwords) — owned only. stats is safe.
  R('GET', `/containers/(${ID})/stats`, ALLOW),
  R('GET', `/containers/(${ID})/(json|logs|top|changes)`, ownedContainer),
  R('GET', `/containers/(${ID})/(archive|export)`, ownedContainer),
  R('HEAD', `/containers/(${ID})/archive`, ownedContainer),
  R('PUT', `/containers/(${ID})/archive`, ownedContainer),
  R('POST', '/containers/create', { body: 'container-create' }),
  R('POST', `/containers/(${ID})/(start|stop|restart|kill|wait|attach|resize|pause|unpause)`, ownedContainer),
  R('POST', `/containers/(${ID})/exec`, { ...ownedContainer, body: 'exec-create' }),
  R('DELETE', `/containers/(${ID})`, ownedContainer),
  R('GET', `/exec/(${ID})/json`, ALLOW),
  R('POST', `/exec/(${ID})/(start|resize)`, ALLOW),
  R('GET', '/images/json', ALLOW),
  R('GET', `/images/(${IMG})/(json|history)`, ALLOW),
  R('GET', `/distribution/(${IMG})/json`, ALLOW),
  R('POST', '/images/create', { query: 'image-create' }),
  R('POST', `/images/(${IMG})/(push|tag)`, { query: 'image-write' }),
  R('POST', '/(images|build)/prune', ALLOW),
  R('POST', '/auth', ALLOW),
  R('POST', '/build', { query: 'build' }),
  R('GET', `/networks(/${ID})?`, ALLOW),
  R('POST', '/networks/create', { body: 'network-create' }),
  R('POST', `/networks/(${ID})/(connect|disconnect)`, { owned: { kind: 'network', group: 1 }, body: 'network-connect' }),
  R('DELETE', `/networks/(${ID})`, { owned: { kind: 'network', group: 1 } }),
  R('GET', `/volumes(/${ID})?`, ALLOW),
  R('POST', '/volumes/create', { body: 'volume-create' }),
  R('DELETE', `/volumes/(${ID})`, { owned: { kind: 'volume', group: 1 } }),
];

// BuildKit's /session + /grpc are opaque gRPC streams the guard cannot
// inspect (a `RUN --network=host` entitlement rides inside them). Runners use
// the legacy builder (DOCKER_BUILDKIT=0); GUARD_ALLOW_BUILDKIT=1 re-opens it as
// an operator-accepted risk (README "Docker API boundary").
const BUILDKIT = [R('POST', '/session', ALLOW), R('POST', '/grpc', ALLOW)];

/**
 * Split `/v1.45/containers/x/json?all=1` into { path: '/containers/x/json', query }.
 * The guard forwards the RAW url, so a path the URL parser would rewrite
 * (`..`, `//`, percent-escapes, backslashes) is refused: what the guard
 * classifies must be byte-for-byte what Docker routes.
 */
export function parseUrl(rawUrl) {
  const rawPath = String(rawUrl).split('?')[0] ?? '';
  if (!rawPath.startsWith('/') || /%|\/\/|\\/.test(rawPath)) throw new Error('non-canonical path');
  const u = new URL(rawUrl, 'http://guard.invalid');
  if (u.pathname !== rawPath) throw new Error('non-canonical path');
  const path = u.pathname.replace(/^\/v[0-9.]+(?=\/)/, '');
  return { path, query: u.searchParams };
}

// `remote` / `fromSrc` make the DAEMON fetch a URL from the VM host network —
// 127.0.0.1:2375 (rl-docker-proxy) included, whose container-inspect JSON a
// build error would echo back. Runners only build/pull from local contexts.
const BUILD_NETWORKS = new Set(['', 'default', 'bridge', 'none']);

function checkBuildQuery(query) {
  // A named network (rl-docker-guard, rl-net) would put classic-builder RUN
  // containers next to the guard or the env containers.
  for (const mode of query.getAll('networkmode')) {
    if (!BUILD_NETWORKS.has(mode)) return `build networkmode=${mode} is not allowed`;
  }
  if (query.getAll('remote').some((v) => v !== '')) return 'build remote= is not allowed';
  if (query.getAll('cgroupparent').some((v) => v !== '')) return 'build cgroupparent= is not allowed';
  return buildTagReason(query);
}

function checkImageCreateQuery(query) {
  return query.has('fromSrc') ? 'images/create fromSrc= is not allowed' : pullReason(query);
}

// Tag / push target must be a runner-writable name (image-refs.mjs).
function checkImageWriteQuery(query, m) {
  return m[2] === 'push' ? pushReason(m[1] ?? '', query) : tagReason(query);
}

const QUERY_CHECKS = { build: checkBuildQuery, 'image-create': checkImageCreateQuery, 'image-write': checkImageWriteQuery };

export function classify(method, rawUrl, { allowBuildkit = false } = {}) {
  let parsed;
  try {
    parsed = parseUrl(rawUrl);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }
  const table = allowBuildkit ? [...ROUTES, ...BUILDKIT] : ROUTES;
  for (const route of table) {
    if (route.method !== method) continue;
    const m = route.re.exec(parsed.path);
    if (!m) continue;
    const plan = route.plan;
    const queryCheck = plan.query ? QUERY_CHECKS[plan.query] : undefined;
    const reason = queryCheck ? queryCheck(parsed.query, m) : null;
    if (reason) return { ok: false, reason };
    const out = { ok: true };
    if (plan.body) out.body = plan.body;
    if (plan.owned) out.owned = { kind: plan.owned.kind, id: m[plan.owned.group] ?? '' };
    return out;
  }
  return { ok: false, reason: `${method} ${parsed.path} is not on the runner allowlist` };
}
