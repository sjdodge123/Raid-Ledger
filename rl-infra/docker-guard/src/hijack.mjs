// ROK-1846 c1 — splice an attach / exec-start hijack AFTER its ownership check.
// The request (headers + exactly Content-Length body bytes) goes up first; the
// client's stream is joined to the daemon only once the daemon answers 101.
// Any other answer is relayed and the client's later bytes are dropped, so a
// declined hijack can never carry a second, unchecked request to the daemon.
import net from 'node:net';

const MAX_PREBODY = 64 * 1024;
const DECLINED_IDLE_MS = 30_000;

/** Read exactly `n` body bytes (head first, then the socket); resolves { body, rest }. */
function collectBody(socket, head, n) {
  return new Promise((resolve, reject) => {
    let buf = head ?? Buffer.alloc(0);
    const finish = () => {
      socket.removeListener('data', onData);
      socket.pause();
      resolve({ body: buf.subarray(0, n), rest: buf.subarray(n) });
    };
    const onData = (c) => {
      buf = Buffer.concat([buf, c]);
      if (buf.length >= n) finish();
    };
    if (buf.length >= n) return finish();
    socket.on('data', onData);
    socket.once('close', () => reject(new Error('client closed before the request body')));
  });
}

/** Join both directions once the daemon has said 101; otherwise relay its answer only. */
function onFirstResponse(up, socket, rest, log) {
  let seen = Buffer.alloc(0);
  const onData = (c) => {
    seen = Buffer.concat([seen, c]);
    if (seen.indexOf('\r\n\r\n') < 0 && seen.length < 16384) return;
    up.removeListener('data', onData);
    socket.write(seen);
    up.pipe(socket);
    if (/^HTTP\/1\.[01] 101 /.test(seen.toString('latin1', 0, 16))) {
      if (rest.length) up.write(rest);
      socket.pipe(up);
      socket.resume();
      return;
    }
    log(`DENY hijack declined by the daemon; closing the client stream`);
    socket.on('data', () => {});
    socket.resume();
    up.setTimeout(DECLINED_IDLE_MS, () => up.destroy());
    up.on('end', () => socket.end());
  };
  up.on('data', onData);
}

/** Splice req/socket to the daemon. Returns a reason string to refuse, or null. */
export async function spliceHijack(socketPath, req, socket, head, log) {
  if (req.headers['transfer-encoding'] !== undefined) return 'chunked hijack requests are not accepted';
  const n = Number(req.headers['content-length'] ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_PREBODY) return 'hijack request body length is invalid';
  const { body, rest } = await collectBody(socket, head, n);
  const up = net.connect(socketPath, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (body.length) up.write(body);
    onFirstResponse(up, socket, rest, log);
  });
  up.on('error', () => socket.destroy());
  up.on('close', () => socket.destroy());
  socket.on('error', () => up.destroy());
  socket.on('close', () => up.destroy());
  return null;
}
