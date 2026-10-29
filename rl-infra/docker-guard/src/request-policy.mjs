// ROK-1846 c1 — which request Content-Types the guard forwards. Docker's
// httputils.ParseForm (Go's r.ParseForm) merges an
// application/x-www-form-urlencoded BODY into the same r.Form the handlers
// read query parameters from, so `remote=` / `networkmode=host` / `fromSrc=`
// sent in a form body skipped every URL-only check. Pure.

// A build body is the context tar (plain or gzip; the guard inspects it).
// No Content-Type is safe: Go treats it as application/octet-stream.
const TAR_TYPES = new Set(['', 'application/x-tar', 'application/tar', 'application/octet-stream', 'application/gzip', 'application/x-gzip']);
const FORM_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data']);

/** The media type without parameters, lower-cased. */
function mediaType(contentType) {
  return String(contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Null when the body may be forwarded, else { status: 415, reason }. */
export function contentTypeReason(plan, contentType) {
  const ct = mediaType(contentType);
  if (plan.context && !TAR_TYPES.has(ct)) return { status: 415, reason: `build body Content-Type ${ct} is not a tar context` };
  if (FORM_TYPES.has(ct)) return { status: 415, reason: `Content-Type ${ct} is refused (Docker reads a form body as query parameters)` };
  return null;
}
