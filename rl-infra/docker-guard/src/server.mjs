// ROK-1846 — rl-docker-guard: a validating Docker API proxy for the runners.
//
// Runners used to bind-mount the raw /var/run/docker.sock (VM root for any
// branch code). They now reach Docker only through this proxy, on the
// internal `rl-docker-guard` network that env containers never join.
// Every request is classified (routes.mjs), bodies of create calls are
// validated + stamped with ownership labels (body-policy.mjs), and calls on an
// existing object require the calling slot to own it. Streams (logs, events,
// build contexts, archives, attach/exec hijacks) are piped, not buffered.
import http from 'node:http';
import net from 'node:net';
import { OWNER_LABEL, parseBindAllow } from './body-policy.mjs';
import { classify } from './routes.mjs';
import { bodyOwnedContainer, checkBody } from './decide.mjs';
import { resourceLabels, runnerForAddress } from './docker-client.mjs';

const SOCKET = process.env.GUARD_DOCKER_SOCKET || '/var/run/docker.sock';
const PORT = Number(process.env.GUARD_PORT || 2375);
const ALLOW = parseBindAllow(process.env.GUARD_BIND_ALLOW);
const ALLOW_BUILDKIT = process.env.GUARD_ALLOW_BUILDKIT === '1';
const MAX_BODY = 1024 * 1024;

const log = (msg) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

function refuse(res, reason) {
  log(`DENY ${reason}`);
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `rl-docker-guard: ${reason}` }));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
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
  return { body: Buffer.from(JSON.stringify(verdict.body)) };
}

function forward(req, res, body) {
  const headers = { ...req.headers };
  if (body) {
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.length);
  }
  const up = http.request({ socketPath: SOCKET, method: req.method, path: req.url, headers }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (e) => refuse(res, `upstream error ${e.message}`));
  if (body) up.end(body);
  else req.pipe(up);
}

async function onRequest(req, res) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  if (!plan.ok) return refuse(res, plan.reason);
  const auth = await authorize(req, plan);
  if (auth.reason) return refuse(res, auth.reason);
  forward(req, res, auth.body);
}

/** attach / exec start hijack the connection (Upgrade: tcp) — splice raw sockets. */
async function onUpgrade(req, socket, head) {
  const plan = classify(req.method ?? '', req.url ?? '/', { allowBuildkit: ALLOW_BUILDKIT });
  const auth = plan.ok && !plan.body ? await authorize(req, plan) : { reason: plan.ok ? 'upgrade with a body check' : plan.reason };
  if (auth.reason) {
    log(`DENY ${auth.reason}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const up = net.connect(SOCKET, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

const server = http.createServer((req, res) => {
  onRequest(req, res).catch((e) => refuse(res, `guard error ${e.message}`));
});
server.on('upgrade', (req, socket, head) => {
  onUpgrade(req, socket, head).catch(() => socket.destroy());
});
server.listen(PORT, '0.0.0.0', () => log(`rl-docker-guard listening on :${PORT} (bind allowlist: ${ALLOW.join(',') || 'none'}, buildkit: ${ALLOW_BUILDKIT})`));
