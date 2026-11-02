// ROK-1900 — serves an approval item's attachments to the inbox page (spec D5).
//
//   GET|HEAD /approvals-content/<id>/<file>
//
// Mockups may carry scripts (operator ruling Q1), so they are only ever
// rendered sandboxed: the page embeds them in <iframe sandbox="allow-scripts">
// (no allow-same-origin) AND every response here carries a CSP whose `sandbox`
// directive keeps the document in an opaque origin even when the URL is opened
// top-level. With `connect-src 'none'` and `default-src 'none'` the mockup
// cannot beacon out or load anything external (Q9).
//
// Auth: the agent token or inbox key HEADER (non-browser clients), or a
// signed `?t=` minted by GET /api/approvals/<id> (approvals-sign.js) — valid
// for this one file of this one item for ~10 minutes. The inbox key is never
// accepted from the query string (the mockup can read its own URL and leak
// it): `?k=` is ignored and the request is 401. Paths are never built from the request:
// the id must match ID_RE, the name a strict filename regex, and the store
// only resolves names the item itself lists. spec.md is never served raw —
// the page renders it from GET /api/approvals/<id> (spec "API routes").
import { readFile } from 'node:fs/promises';
import { noteDenial, preGate } from './approvals-limits.js';
import { ApprovalError, ID_RE, sniffImage } from './approvals-validate.js';

export const CONTENT_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: 'self'",
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const CONTENT_HEADERS = Object.freeze({
  'content-security-policy': CONTENT_CSP,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-store',
});

const PATH_RE = /^\/approvals-content\/([^/]+)\/([^/]+)$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}\.(html|png|jpg|webp)$/;
const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' });

const sendError = (res, status, error, extra = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra,
  });
  res.end(JSON.stringify({ ok: false, error }));
};

const queryToken = (req) => new URLSearchParams((req.url || '').split('?')[1] ?? '').get('t');

const BAD_TOKEN = Object.freeze({ status: 403, error: 'content_token_invalid' });
// A genuine token past its expiry (a page left open > 10 min) is not a
// guessing attempt, so it is not counted towards the auth-failure lockout.
const EXPIRED_TOKEN = Object.freeze({ status: 403, error: 'content_token_expired', uncounted: true });

// null when allowed, else { status, error }. Header auth first; otherwise a
// `?t=` must verify for exactly (id, name) — tampered or minted for another
// file/item is 403 content_token_invalid (counted); a genuine but expired one
// is 403 content_token_expired (not counted). Neither the inbox key nor the agent token is
// ever read from the query string.
const denial = (auth, signer, req, id, name) => {
  const viaHeader = auth.deny(req, 'read');
  if (!viaHeader || viaHeader.status === 503) return viaHeader;
  const t = queryToken(req);
  if (t === null || !signer) return t === null ? viaHeader : BAD_TOKEN;
  const verdict = signer.check(id, name, t);
  if (verdict === 'ok') return null;
  return verdict === 'expired' ? EXPIRED_TOKEN : BAD_TOKEN;
};

// Content type from the bytes for images (never the name); html as uploaded.
export const contentTypeFor = (name, buf) => {
  if (name === 'mockup.html') return 'text/html; charset=utf-8';
  const sniffed = sniffImage(buf);
  const ext = name.split('.').pop();
  return sniffed && sniffed === ext ? IMAGE_TYPES[sniffed] : null;
};

const serve = async (store, id, name, req, res) => {
  const buf = await readFile(await store.filePath(id, name));
  const type = contentTypeFor(name, buf);
  if (!type) { sendError(res, 415, 'unsupported_media_type'); return; }
  res.writeHead(200, { ...CONTENT_HEADERS, 'content-type': type, 'content-length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
};

// Returns an async (req, res, pathOnly) => boolean — true when it answered.
export const createApprovalContent = ({
  store, auth, signer = null, limits = null, ipOf = () => null,
}) => async (req, res, pathOnly) => {
  if (!pathOnly.startsWith('/approvals-content/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'method_not_allowed', { allow: 'GET, HEAD' });
    return true;
  }
  const ip = ipOf(req);
  if (limits && preGate(limits, ip, req, res, auth)) return true;
  const m = pathOnly.match(PATH_RE);
  const [, rawId = '', rawName = ''] = m ?? [];
  let id = rawId;
  let name = rawName;
  try { id = decodeURIComponent(rawId); name = decodeURIComponent(rawName); } catch { /* checked below */ }
  const denied = denial(auth, signer, req, id, name);
  if (denied) {
    if (limits && !denied.uncounted) noteDenial(limits, ip, denied.status);
    sendError(res, denied.status, denied.error);
    return true;
  }
  if (!m || !ID_RE.test(id) || !NAME_RE.test(name)) { sendError(res, 404, 'not_found'); return true; }
  try {
    await serve(store, id, name, req, res);
  } catch (err) {
    if (err instanceof ApprovalError) sendError(res, err.status, err.code);
    else if (err?.code === 'ENOENT') sendError(res, 404, 'not_found');
    else throw err;
  }
  return true;
};
