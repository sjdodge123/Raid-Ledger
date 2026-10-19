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
import { dockerfileParamReason, parseQuery, QueryError } from './query-parse.mjs';

const ID = '[A-Za-z0-9_.-]+';
const IMG = '[A-Za-z0-9_.@:/-]+';
const R = (method, pattern, plan) => ({ method, re: new RegExp(`^${pattern}$`), plan });

const ALLOW = {};
const ownedContainer = { owned: { kind: 'container', group: 1 } };

const ROUTES = [
  R('GET', '/(_ping|version|info)', ALLOW),
  // c6: exec events carry the exec's command line — scoped to the caller's
  // own objects by a server-side label filter (events-scope.mjs).
  R('GET', '/events', { events: true }),
  R('HEAD', '/_ping', ALLOW),
  R('GET', '/containers/json', ALLOW),
  // Inspect / logs of another slot's or an env's container would hand a runner
  // its Env (Discord bot tokens, admin passwords) — owned only. stats is safe.
  R('GET', `/containers/(${ID})/stats`, ALLOW),
  R('GET', `/containers/(${ID})/(json|logs|top|changes)`, ownedContainer),
  R('GET', `/containers/(${ID})/(archive|export)`, ownedContainer),
  R('HEAD', `/containers/(${ID})/archive`, ownedContainer),
  R('PUT', `/containers/(${ID})/archive`, ownedContainer),
  R('POST', '/containers/create', { body: 'container-create', query: 'container-create' }),
  // attach + exec start are the only routes that may hijack (Upgrade: tcp).
  R('POST', `/containers/(${ID})/attach`, { ...ownedContainer, hijack: true }),
  R('POST', `/containers/(${ID})/(start|stop|restart|kill|wait|resize|pause|unpause)`, ownedContainer),
  R('POST', `/containers/(${ID})/exec`, { ...ownedContainer, body: 'exec-create' }),
  R('DELETE', `/containers/(${ID})`, ownedContainer),
  // GET /events streams every exec's execID, so an id is not a secret: the
  // exec's container must be the caller's (docker-client.mjs resolves it).
  R('GET', `/exec/(${ID})/json`, { owned: { kind: 'exec', group: 1 } }),
  R('POST', `/exec/(${ID})/start`, { owned: { kind: 'exec', group: 1 }, hijack: true }),
  R('POST', `/exec/(${ID})/resize`, { owned: { kind: 'exec', group: 1 } }),
  R('GET', '/images/json', ALLOW),
  R('GET', `/images/(${IMG})/(json|history)`, ALLOW),
  R('GET', `/distribution/(${IMG})/json`, ALLOW),
  R('POST', '/images/create', { query: 'image-create' }),
  R('POST', `/images/(${IMG})/(push|tag)`, { query: 'image-write' }),
  R('POST', '/(images|build)/prune', ALLOW),
  R('POST', '/auth', ALLOW),
  R('POST', '/build', { query: 'build', context: true }),
  R('GET', `/networks(/${ID})?`, ALLOW),
  R('POST', '/networks/create', { body: 'network-create' }),
  R('POST', `/networks/(${ID})/(connect|disconnect)`, { owned: { kind: 'network', group: 1 }, body: 'network-connect' }),
  R('DELETE', `/networks/(${ID})`, { owned: { kind: 'network', group: 1 } }),
  R('GET', `/volumes(/${ID})?`, ALLOW),
  R('POST', '/volumes/create', { body: 'volume-create' }),
  R('DELETE', `/volumes/(${ID})`, { owned: { kind: 'volume', group: 1 } }),
];

// BuildKit's /session + /grpc are opaque gRPC streams over a connection upgrade
// the guard cannot inspect (a `RUN --network=host` entitlement rides inside
// them), so they are never proxied. Runners use the legacy builder
// (DOCKER_BUILDKIT=0). c8: GUARD_ALLOW_BUILDKIT=1 opens nothing — it only turns
// the generic 403 into an explicit 400 (plus a startup warning in guard.mjs).
const BUILDKIT_PATH = /^\/(session|grpc)$/;
const BUILDKIT_UNSUPPORTED = 'buildkit_session_unsupported: rl-docker-guard does not proxy BuildKit /session or /grpc upgrades; build with DOCKER_BUILDKIT=0';

/**
 * Split `/v1.45/containers/x/json?all=1` into { path: '/containers/x/json', query }.
 * The guard forwards the RAW url, so a path the URL parser would rewrite
 * (`..`, `//`, percent-escapes, backslashes) is refused: what the guard
 * classifies must be byte-for-byte what Docker routes.
 */
export function parseUrl(rawUrl) {
  const raw = String(rawUrl);
  const q = raw.indexOf('?');
  const rawPath = q < 0 ? raw : raw.slice(0, q);
  if (!rawPath.startsWith('/') || /%|\/\/|\\/.test(rawPath)) throw new Error('non-canonical path');
  const u = new URL(rawPath, 'http://guard.invalid');
  if (u.pathname !== rawPath) throw new Error('non-canonical path');
  const path = u.pathname.replace(/^\/v[0-9.]+(?=\/)/, '');
  // c5: the query is parsed as Go parses it (query-parse.mjs), never by WHATWG.
  return { path, query: parseQuery(q < 0 ? '' : raw.slice(q + 1)) };
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
  if (query.has('remote')) return 'build remote= is not allowed (no daemon-side fetch)';
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

// rl-runner-N is the guard's caller identity (docker-client.mjs); rl-env-<slug>-*
// is what release / the reapers act on; the rest are compose infra names. A
// runner squatting any of them would impersonate or DoS it.
const RESERVED_NAME = /^\/?rl-(runner-|env-|docker-|gc-sweeper$|traefik$|registry$|loki$|promtail$|grafana$|dashboard$|orchestrator)/;

function checkContainerCreateQuery(query) {
  const bad = query.getAll('name').find((n) => RESERVED_NAME.test(n));
  return bad === undefined ? null : `container name ${bad} is reserved for infra / runners / envs`;
}

const QUERY_CHECKS = { 'container-create': checkContainerCreateQuery, build: checkBuildQuery, 'image-create': checkImageCreateQuery, 'image-write': checkImageWriteQuery };

// Docker's httputils.BoolValue: anything but "", 0, no, false, none is true.
const truthy = (v) => v !== null && !['', '0', 'no', 'false', 'none'].includes(v.trim().toLowerCase());

/** What /build's context inspection needs from the (already policy-checked) query. */
function buildFacts(query) {
  return { context: true, dockerfile: query.get('dockerfile') ?? '', pull: truthy(query.get('pull')) };
}

/**
 * Classify a request. A refusal carries `status` 400 when the request-target
 * itself is ambiguous (bad_request_target), else the server answers 403.
 */
export function classify(method, rawUrl, { allowBuildkit = false } = {}) {
  let parsed;
  try {
    parsed = parseUrl(rawUrl);
  } catch (e) {
    if (e instanceof QueryError) return { ok: false, status: 400, reason: `bad_request_target: ${e.message}` };
    return { ok: false, reason: 'unparseable URL' };
  }
  const dfBad = dockerfileParamReason(parsed.query.get('dockerfile'));
  if (dfBad) return { ok: false, status: 400, reason: `bad_request_target: ${dfBad}` };
  if (allowBuildkit && method === 'POST' && BUILDKIT_PATH.test(parsed.path)) return { ok: false, status: 400, reason: BUILDKIT_UNSUPPORTED };
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = route.re.exec(parsed.path);
    if (!m) continue;
    const plan = route.plan;
    const queryCheck = plan.query ? QUERY_CHECKS[plan.query] : undefined;
    const reason = queryCheck ? queryCheck(parsed.query, m) : null;
    if (reason) return { ok: false, reason };
    const out = { ok: true };
    if (plan.body) out.body = plan.body;
    if (plan.hijack) out.hijack = true;
    if (plan.events) out.events = true;
    if (plan.context) Object.assign(out, buildFacts(parsed.query));
    if (plan.owned) out.owned = { kind: plan.owned.kind, id: m[plan.owned.group] ?? '' };
    return out;
  }
  return { ok: false, reason: `${method} ${parsed.path} is not on the runner allowlist` };
}
