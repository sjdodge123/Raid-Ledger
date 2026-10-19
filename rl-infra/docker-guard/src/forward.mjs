// ROK-1846 c1 — forward one checked request to the daemon. Hop-by-hop headers
// (Connection / Upgrade / Keep-Alive …) never cross the guard: an Upgrade that
// reached Docker on `GET /_ping` turned the connection into a raw tunnel whose
// later requests the guard never saw. Upstream is one request per connection.
import http from 'node:http';

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
 */
export function forward(socketPath, req, res, body, onError, path = req.url) {
  const headers = { ...stripHop(req.headers), connection: 'close' };
  const length = body?.buf ? body.buf.length : body?.length;
  if (length !== undefined) {
    delete headers['transfer-encoding'];
    headers['content-length'] = String(length);
  }
  const up = http.request({ socketPath, method: req.method, path, headers, agent: false }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, stripHop(upRes.headers));
    upRes.pipe(res);
  });
  up.on('error', (e) => onError(`upstream error ${e.message}`));
  if (body?.buf) up.end(body.buf);
  else if (body?.stream) body.stream.pipe(up);
  else req.pipe(up);
}
