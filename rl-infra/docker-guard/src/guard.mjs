// ROK-1846 — rl-docker-guard core: request handling (server.mjs only listens).
//
// Runners used to bind-mount the raw /var/run/docker.sock (VM root for any
// branch code). They now reach Docker only through this proxy, on the
// internal `rl-docker-guard` network that env containers never join.
// Every request is classified (routes.mjs), bodies of create calls are
// validated + stamped with ownership labels (body-policy.mjs), and calls on an
// existing object require the calling slot to own it. Streams (logs, events,
// build contexts, archives, attach/exec hijacks) are piped, not buffered.
import http from 'node:http';
import { OWNER_LABEL } from './body-policy.mjs';
import { forward, wantsUpgrade } from './forward.mjs';
import { spliceHijack } from './hijack.mjs';
import { contentTypeReason } from './request-policy.mjs';
import fs from 'node:fs';
import { spoolBuildContext } from './build-context.mjs';
import { classify } from './routes.mjs';
import { bodyOwnedContainer, checkBody } from './decide.mjs';
import { ensureOwnedVolume, resourceInfo, runnerForAddress } from './docker-client.mjs';
import { pinnedRef, pinPathRef } from './ref-pin.mjs';
import { namedVolumeRefs } from './volume-refs.mjs';
import { connectNetworkRefs, containerCreateNetworkRefs, resolveNetworkRefs } from './network-refs.mjs';
import { pinConnect, pinContainerCreate } from './network-pin.mjs';
import { reservedVolumeReason } from './volume-reserve.mjs';
import { scopedEventsUrl } from './events-scope.mjs';

const MAX_BODY = 1024 * 1024;
const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 415: 'Unsupported Media Type', 500: 'Internal Server Error', 502: 'Bad Gateway', 507: 'Insufficient Storage' };
let SOCKET = '/var/run/docker.sock';
let ALLOW = [];
let ALLOW_BUILDKIT = false;
let TMPDIR;
let log = () => {};

function refuse(res, reason, status = 403) {
  log(`DENY ${reason}`);
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
  res.end(JSON.stringify({ message: `rl-docker-guard: ${reason}` }));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
    req.on('close', () => resolve(null));
  });
}

/**
 * The ref to forward when `owner` owns what `ref` resolves to, else null.
 * R6: a container / network comes back as the full ID the inspect saw
 * (ref-pin.mjs), so Docker cannot re-resolve the forwarded ref elsewhere.
 */
async function ownedRef(kind, ref, owner) {
  const info = await resourceInfo(SOCKET, kind, ref);
  if (info === null || info.labels[OWNER_LABEL] !== owner.owner) return null;
  return pinnedRef(kind, ref, info.id);
}

async function owns(kind, id, owner) {
  return (await ownedRef(kind, id, owner)) !== null;
}

/** Returns { reason } to refuse, or { body } (Buffer|undefined) and { url } to forward. */
async function authorize(req, plan) {
  if (!plan.body && !plan.owned) return {};
  const owner = await runnerForAddress(SOCKET, req.socket.remoteAddress);
  if (!owner) return { reason: `caller ${req.socket.remoteAddress} is not a known runner` };
  let url;
  if (plan.owned) {
    const pinned = await ownedRef(plan.owned.kind, plan.owned.id, owner);
    if (pinned === null) return { reason: `${plan.owned.kind} ${plan.owned.id} is not owned by ${owner.owner}` };
    url = pinPathRef(req.url ?? '', plan.owned.kind, pinned);
  }
  if (!plan.body) return { url };
  const raw = await readBody(req);
  if (raw === null) return { reason: 'request body unreadable or over 1 MiB' };
  let parsed;
  try {
    parsed = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    return { reason: 'request body is not JSON' };
  }
  const verdict = checkBody(plan.body, parsed, { allow: ALLOW, owner });
  if (!verdict.ok) return { reason: verdict.reason };
  let body = verdict.body;
  const target = bodyOwnedContainer(plan.body, parsed);
  if (target !== null) {
    const cid = await ownedRef('container', target, owner);
    if (cid === null) return { reason: `container ${target} is not owned by ${owner.owner}` };
    body = { ...body, Container: cid };
  }
  const pinned = await pinNetworks(req, plan, body, owner);
  if (pinned.reason) return pinned;
  if (plan.body === 'container-create') {
    for (const name of namedVolumeRefs(pinned.body)) {
      const reserved = reservedVolumeReason(name);
      if (reserved) return { reason: reserved };
      if (!(await ensureOwnedVolume(SOCKET, name, owner, OWNER_LABEL))) return { reason: `volume ${name} is not owned by ${owner.owner}` };
    }
  }
  return { body: Buffer.from(JSON.stringify(pinned.body)), url: pinned.url ?? url };
}

/**
 * R5 M2: resolve every network ref once and forward the full IDs the check
 * saw (network-pin.mjs). A (dis)connect's URL network is owner-checked again
 * by that ID: the first check resolved the ref separately.
 */
async function pinNetworks(req, plan, body, owner) {
  const connect = plan.body === 'network-connect';
  const refs = plan.body === 'container-create' ? containerCreateNetworkRefs(body) : connect ? connectNetworkRefs(plan.owned?.id, body) : [];
  const { reason, ids } = await resolveNetworkRefs(SOCKET, refs);
  if (reason) return { reason };
  if (plan.body === 'container-create') return pinContainerCreate(body, ids);
  if (!connect) return { body };
  const urlNet = ids.get(plan.owned?.id ?? '');
  if (urlNet === undefined || !(await owns('network', urlNet, owner))) return { reason: `network ${plan.owned?.id} is not owned by ${owner.owner}` };
  return pinConnect(req.url ?? '', plan.owned?.id ?? '', body, ids);
}

async function onRequest(req, res) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  if (wantsUpgrade(req.headers)) return refuse(res, `${req.method} ${req.url} may not upgrade the connection`, 400);
  if (!plan.ok) return refuse(res, plan.reason, plan.status ?? 403);
  const media = contentTypeReason(plan, req.headers['content-type']);
  if (media) return refuse(res, media.reason, media.status);
  const auth = await authorize(req, plan);
  if (auth.reason) return refuse(res, auth.reason);
  if (plan.context) return forwardBuild(req, res, plan);
  if (plan.events) return forwardEvents(req, res);
  forward(SOCKET, req, res, auth.body ? { buf: auth.body } : undefined, (r) => refuse(res, r, 502), auth.url ?? req.url);
}

/** /events: only the caller's own objects (events-scope.mjs). */
async function forwardEvents(req, res) {
  const owner = await runnerForAddress(SOCKET, req.socket.remoteAddress);
  if (!owner) return refuse(res, `caller ${req.socket.remoteAddress} is not a known runner`);
  let url;
  try {
    url = scopedEventsUrl(req.url ?? '/events', owner);
  } catch (e) {
    return refuse(res, `bad_request_target: ${e.message}`, 400);
  }
  forward(SOCKET, req, res, undefined, (r) => refuse(res, r, 502), url);
}

/**
 * /build: spool + inspect the context, then stream the spooled copy upstream.
 * c8: the client's close is watched BEFORE the spool is awaited — a runner that
 * cancels while the spool finishes gets nothing forwarded and its context removed.
 */
async function forwardBuild(req, res, plan) {
  let gone = false;
  const onGone = () => { gone = true; };
  res.on('close', onGone);
  // c5: the dockerfile= value classify() decoded (Go's table) — never re-parsed.
  const ctx = await spoolBuildContext(req, plan.dockerfile ?? '', TMPDIR, { pull: plan.pull === true });
  res.off('close', onGone);
  if (ctx.error) {
    ctx.cleanup();
    return refuse(res, ctx.error.reason, ctx.error.status);
  }
  if (gone || res.destroyed) {
    ctx.cleanup();
    return log('DROP /build: the client went away before its context finished spooling');
  }
  res.on('close', ctx.cleanup);
  forward(SOCKET, req, res, { stream: fs.createReadStream(ctx.file), length: ctx.size }, (r) => refuse(res, r, 502));
}

function refuseSocket(socket, status, reason) {
  log(`DENY ${reason}`);
  const body = JSON.stringify({ message: `rl-docker-guard: ${reason}` });
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

/**
 * Only attach / exec start may hijack the connection (Upgrade: tcp), and only
 * after their ownership check; any other upgrade attempt is a 400.
 */
async function onUpgrade(req, socket, head) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  if (!plan.ok) return refuseSocket(socket, plan.status ?? 403, plan.reason);
  if (!plan.hijack) return refuseSocket(socket, 400, `${req.method} ${req.url} may not upgrade the connection`);
  const auth = await authorize(req, plan);
  if (auth.reason) return refuseSocket(socket, 403, auth.reason);
  const reason = await spliceHijack(SOCKET, req, socket, head, log, auth.url ?? req.url);
  if (reason) refuseSocket(socket, 400, reason);
}

/** Build the guard's http.Server (not listening). */
export function createGuardServer({ socket, allow = [], allowBuildkit = false, logger = () => {}, tmpDir = undefined }) {
  TMPDIR = tmpDir;
  SOCKET = socket;
  ALLOW = allow;
  ALLOW_BUILDKIT = allowBuildkit;
  log = logger;
  // c8: the flag does not open BuildKit (routes.mjs) — say so once, loudly.
  if (allowBuildkit) log('WARN GUARD_ALLOW_BUILDKIT=1: BuildKit /session and /grpc upgrades are not proxied by rl-docker-guard; they are refused 400 buildkit_session_unsupported. Build with DOCKER_BUILDKIT=0.');
  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((e) => refuse(res, `guard error ${e.message}`));
  });
  server.on('upgrade', (req, sock, head) => {
    onUpgrade(req, sock, head).catch(() => sock.destroy());
  });
  return server;
}
