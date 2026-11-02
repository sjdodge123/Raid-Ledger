// ROK-1900 — signed, short-lived, single-file content URLs for the inbox page.
//
// An <iframe>/<img> src cannot carry a header, and the mockup inside the frame
// is untrusted code that can read its own location and navigate away with it.
// So the inbox key NEVER goes in a URL. Instead GET /api/approvals/<id>
// (authenticated by header) mints one URL per attachment:
//
//   /approvals-content/<id>/<file>?t=<exp>.<sig>
//     exp = unix seconds, ~10 minutes ahead
//     sig = base64url(HMAC-SHA256(bootSecret, `${id}|${file}|${exp}`))
//
// A token is read-only and valid for exactly that one file of that one item
// until exp. If a mockup leaks its own `?t=`, the leak only re-reads a file the
// mockup's author already has (they uploaded it) — it grants nothing else:
// no other item, no other file, no list, no ruling, no plan step.
//
// bootSecret is crypto.randomBytes(32) per process: never persisted, never
// logged. A restart simply invalidates every outstanding URL; the page
// re-fetches the item and gets fresh ones.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONTENT_URL_TTL_MS = 10 * 60 * 1000;
const TOKEN_RE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export const createContentSigner = ({
  secret = randomBytes(32), ttlMs = CONTENT_URL_TTL_MS, now = () => Date.now(),
} = {}) => {
  const mac = (id, file, exp) =>
    createHmac('sha256', secret).update(`${id}|${file}|${exp}`, 'utf8').digest();

  const token = (id, file, exp) => `${exp}.${mac(id, file, exp).toString('base64url')}`;

  // { url, expires_at } for one attachment.
  const sign = (id, file) => {
    const exp = Math.floor((now() + ttlMs) / 1000);
    const url = `/approvals-content/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
      + `?t=${token(id, file, exp)}`;
    return { url, expires_at: new Date(exp * 1000).toISOString() };
  };

  // 'ok' | 'expired' | 'bad'. The MAC is checked BEFORE the expiry, so
  // 'expired' always means a genuine token minted for exactly (id, file).
  const check = (id, file, presented) => {
    const m = typeof presented === 'string' ? presented.match(TOKEN_RE) : null;
    if (!m) return 'bad';
    const exp = Number(m[1]);
    if (!Number.isSafeInteger(exp)) return 'bad';
    const got = Buffer.from(m[2], 'base64url');
    const want = mac(id, file, exp);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return 'bad';
    return exp * 1000 <= now() ? 'expired' : 'ok';
  };

  // true only for an unexpired token minted for exactly (id, file).
  const verify = (id, file, presented) => check(id, file, presented) === 'ok';

  return Object.freeze({ sign, verify, check });
};

// The signed URL set for an item's servable attachments (mockup + screenshots;
// spec.md is never served raw). { files: { <name>: url }, expires_at }.
export const contentUrlsFor = (signer, item) => {
  const att = item?.attachments || {};
  const names = [
    ...(typeof att.mockup === 'string' ? [att.mockup] : []),
    ...(Array.isArray(att.screenshots) ? att.screenshots.map((s) => s?.file).filter((f) => typeof f === 'string') : []),
  ];
  const files = {};
  let expiresAt = null;
  for (const name of names) {
    const { url, expires_at: exp } = signer.sign(item.id, name);
    files[name] = url;
    expiresAt = exp;
  }
  return { files, expires_at: expiresAt };
};
