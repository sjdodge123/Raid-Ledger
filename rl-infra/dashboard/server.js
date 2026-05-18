// rl-dashboard — tiny mobile-friendly fleet status page.
//
// Reads /state/claims.json + /state/env-registry.json (both bind-mounted from
// the host's /srv/rl-infra/state/ as read-only) and serves a single HTML page
// + a /api/state JSON endpoint that the page polls every 5s.
//
// Routed via Traefik at fleet.rl.lan (wildcard *.rl.lan -> 192.168.0.132
// already resolves; no extra Pi-hole entry needed).
//
// Intentionally zero deps. Pure Node http module.

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const STATE_DIR = process.env.STATE_DIR || '/state';
const PUBLIC_DIR = process.env.PUBLIC_DIR || '/app/public';
const PORT = parseInt(process.env.PORT || '8080', 10);
// When set, the dashboard renders BOTH http://{slug}.rl.lan (internal) AND
// http://{slug}.${PUBLIC_DOMAIN} (external, for testers behind your proxy)
// as links per env. env-spin already writes Traefik routes for both.
const PUBLIC_DOMAIN = process.env.RL_PUBLIC_DOMAIN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// TCP probe with short timeout. Used to detect whether the runner is
// actively serving a dev server on its conventional ports — slots are just
// shell containers until an agent runs `npm run dev -w web` or starts a
// Node process with --inspect. Without this probe, the dashboard's web/
// debug buttons would always render but 502 on click whenever nothing is
// listening, which is most of the time.
const probePort = (host, port, timeoutMs = 400) =>
  new Promise((resolve) => {
    let done = false;
    const socket = createConnection({ host, port });
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });

const enrichSlotsWithProbes = async (slots) =>
  Promise.all(
    slots.map(async (slot) => {
      // Slot containers are reachable by name on the rl-net Docker network.
      // Conventional dev ports: 5173 (Vite), 9229 (Node inspector).
      const host = `rl-runner-${slot.slot}`;
      const [webUp, debugUp] = await Promise.all([
        probePort(host, 5173),
        probePort(host, 9229),
      ]);
      return { ...slot, web_listening: webUp, debug_listening: debugUp };
    }),
  );

const handleApiState = async (res) => {
  try {
    const [claims, envs] = await Promise.all([
      readFile(join(STATE_DIR, 'claims.json'), 'utf-8'),
      readFile(join(STATE_DIR, 'env-registry.json'), 'utf-8'),
    ]);
    const slots = JSON.parse(claims);
    const probedSlots = await enrichSlotsWithProbes(slots);
    sendJson(res, 200, {
      ok: true,
      slots: probedSlots,
      envs: JSON.parse(envs),
      public_domain: PUBLIC_DOMAIN || null,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
};

const sanitizePath = (urlPath) => {
  // Disallow directory traversal. Only allow files under PUBLIC_DIR.
  const cleaned = urlPath.split('?')[0].split('#')[0];
  if (cleaned.includes('..')) return null;
  return cleaned === '/' ? '/index.html' : cleaned;
};

const serveStatic = async (req, res) => {
  const path = sanitizePath(req.url);
  if (!path) {
    res.writeHead(400);
    res.end('Bad path');
    return;
  }
  try {
    const data = await readFile(join(PUBLIC_DIR, path));
    const ct = MIME[extname(path)] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': ct,
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
};

const server = createServer(async (req, res) => {
  // Liveness probe for compose healthchecks / orchestrator pings.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === '/api/state') {
    await handleApiState(res);
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`rl-dashboard listening on :${PORT}, state=${STATE_DIR}, public=${PUBLIC_DIR}`);
});
