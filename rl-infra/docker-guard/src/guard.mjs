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
import { classify } from './routes.mjs';
import { bodyOwnedContainer, checkBody } from './decide.mjs';
import { ensureOwnedVolume, resourceLabels, runnerForAddress } from './docker-client.mjs';
import { namedVolumeRefs } from './volume-refs.mjs';

const MAX_BODY = 1024 * 1024;
const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 415: 'Unsupported Media Type' };
let SOCKET = '/var/run/docker.sock';
let ALLOW = [];
let ALLOW_BUILDKIT = false;
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

async function owns(kind, id, owner) {
  const labels = await resourceLabels(SOCKET, kind, id);
  return labels !== null && labels[OWNER_LABEL] === owner.owner;
}

/** Returns { reason } to refuse, or { body } (Buffer|undefined) to forward. */
async function authorize(req, plan) {
  if (!plan.body && !plan.owned) return {};
  const owner = await runnerForAddress(SOCKET, req.socket.remoteAddress);
  if (!owner) return { reason: `caller ${req.socket.remoteAddress} is not a known runner` };
  if (plan.owned && !(await owns(plan.owned.kind, plan.owned.id, owner))) {
    return { reason: `${plan.owned.kind} ${plan.owned.id} is not owned by ${owner.owner}` };
  }
  if (!plan.body) return {};
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
  const target = bodyOwnedContainer(plan.body, parsed);
  if (target !== null && !(await owns('container', target, owner))) return { reason: `container ${target} is not owned by ${owner.owner}` };
  if (plan.body === 'container-create') {
    for (const name of namedVolumeRefs(verdict.body)) {
      if (!(await ensureOwnedVolume(SOCKET, name, owner, OWNER_LABEL))) return { reason: `volume ${name} is not owned by ${owner.owner}` };
    }
  }
  return { body: Buffer.from(JSON.stringify(verdict.body)) };
}

async function onRequest(req, res) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  if (wantsUpgrade(req.headers)) return refuse(res, `${req.method} ${req.url} may not upgrade the connection`, 400);
  if (!plan.ok) return refuse(res, plan.reason);
  const media = contentTypeReason(plan, req.headers['content-type']);
  if (media) return refuse(res, media.reason, media.status);
  const auth = await authorize(req, plan);
  if (auth.reason) return refuse(res, auth.reason);
  forward(SOCKET, req, res, auth.body ? { buf: auth.body } : undefined, (r) => refuse(res, r, 502));
}

function refuseSocket(socket, status, reason) {
  log(`DENY ${reason}`);
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

/**
 * Only attach / exec start may hijack the connection (Upgrade: tcp), and only
 * after their ownership check; any other upgrade attempt is a 400.
 */
async function onUpgrade(req, socket, head) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  if (!plan.ok) return refuseSocket(socket, 403, plan.reason);
  if (!plan.hijack) return refuseSocket(socket, 400, `${req.method} ${req.url} may not upgrade the connection`);
  const auth = await authorize(req, plan);
  if (auth.reason) return refuseSocket(socket, 403, auth.reason);
  const reason = await spliceHijack(SOCKET, req, socket, head, log);
  if (reason) refuseSocket(socket, 400, reason);
}

/** Build the guard's http.Server (not listening). */
export function createGuardServer({ socket, allow = [], allowBuildkit = false, logger = () => {} }) {
  SOCKET = socket;
  ALLOW = allow;
  ALLOW_BUILDKIT = allowBuildkit;
  log = logger;
  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((e) => refuse(res, `guard error ${e.message}`));
  });
  server.on('upgrade', (req, sock, head) => {
    onUpgrade(req, sock, head).catch(() => sock.destroy());
  });
  return server;
}
