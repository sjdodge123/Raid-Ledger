// ROK-1900 — serves an approval item's attachments to the inbox page (spec D5).
//
//   GET|HEAD /approvals-content/<id>/<file>
//
// Mockups may carry scripts (operator ruling Q1), so they are only ever
// rendered sandboxed: the page embeds them in <iframe sandbox="allow-scripts">
// (no allow-same-origin) AND every response here carries a CSP whose `sandbox`
// directive keeps the document in an opaque origin even when the URL is opened
// top-level. With `connect-src 'none'` and `default-src 'none'` the mockup
// cannot beacon out or load anything external (Q9); no-referrer keeps the
// `?k=` key out of any request the frame makes.
//
// Auth: the agent token, the inbox key header, or `?k=<inbox key>` (an iframe
// or <img> src cannot send headers). Paths are never built from the request:
// the id must match ID_RE, the name a strict filename regex, and the store
// only resolves names the item itself lists. spec.md is never served raw —
// the page renders it from GET /api/approvals/<id> (spec "API routes").
import { readFile } from 'node:fs/promises';
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

const queryKey = (req) => {
  const k = new URLSearchParams((req.url || '').split('?')[1] ?? '').get('k');
  return typeof k === 'string' && k.length > 0 ? k : null;
};

// null when allowed, else { status, error }. A `?k=` only ever counts as the
// inbox key; it is never compared against the agent token.
const denial = (auth, req) => {
  const viaHeader = auth.deny(req, 'read');
  if (!viaHeader) return null;
  if (viaHeader.status === 503) return viaHeader;
  const k = queryKey(req);
  return k !== null && auth.keyOk(k) ? null : viaHeader;
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
export const createApprovalContent = ({ store, auth }) => async (req, res, pathOnly) => {
  if (!pathOnly.startsWith('/approvals-content/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'method_not_allowed', { allow: 'GET, HEAD' });
    return true;
  }
  const denied = denial(auth, req);
  if (denied) { sendError(res, denied.status, denied.error); return true; }
  const m = pathOnly.match(PATH_RE);
  const [, id = '', name = ''] = m ?? [];
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
