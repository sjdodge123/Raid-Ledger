// ROK-1846 c1 — forward one checked request to the daemon. Hop-by-hop headers
// (Connection / Upgrade / Keep-Alive …) never cross the guard: an Upgrade that
// reached Docker on `GET /_ping` turned the connection into a raw tunnel whose
// later requests the guard never saw. Upstream is one request per connection.
import http from 'node:http';
import { pipeline } from 'node:stream';

const HOP = ['connection', 'upgrade', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'http2-settings'];

/** Copy of `headers` without hop-by-hop fields. */
export function stripHop(headers) {
  const out = { ...headers };
  for (const h of HOP) delete out[h];
  return out;
}

/** True when the request asks for any protocol upgrade / hijack. */
export function wantsUpgrade(headers) {
  return headers.upgrade !== undefined || /(^|,)\s*upgrade\s*(,|$)/i.test(String(headers.connection ?? ''));
}

/**
 * Pipe req → daemon → res. `body` replaces the request body:
 * { buf: Buffer } (a rewritten JSON body) or { stream, length } (a spooled build context).
 * `path` replaces the request-target (c6: /events gets a rebuilt query).
 * c7: `pipe()` never propagates closure, so a runner that goes away (cancelled
 * build, dropped /events or /logs follow) explicitly tears the upstream request
 * and response down — the daemon stops the build / subscription with it.
 */
export function forward(socketPath, req, res, body, onError, path = req.url) {
  const headers = { ...stripHop(req.headers), connection: 'close' };
  const length = body?.buf ? body.buf.length : body?.length;
  if (length !== undefined) {
    delete headers['transfer-encoding'];
    headers['content-length'] = String(length);
  }
  let upRes = null;
  const up = http.request({ socketPath, method: req.method, path, headers, agent: false }, (r) => {
    upRes = r;
    if (res.destroyed) return r.destroy();
    res.writeHead(r.statusCode ?? 502, stripHop(r.headers));
    pipeline(r, res, () => {});
  });
  const teardown = () => {
    up.destroy();
    upRes?.destroy();
    body?.stream?.destroy();
  };
  res.once('close', () => { if (!res.writableFinished) teardown(); });
  req.once('error', teardown);
  up.on('error', (e) => {
    if (res.destroyed) return;
    if (res.headersSent) res.destroy();
    else onError(`upstream error ${e.message}`);
  });
  if (body?.buf) up.end(body.buf);
  else if (body?.stream) body.stream.on('error', (e) => up.destroy(e)).pipe(up);
  else req.pipe(up);
}
