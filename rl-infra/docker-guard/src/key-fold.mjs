// ROK-1846 — Go's encoding/json matches struct fields case-INSENSITIVELY (and
// folds U+017F 'ſ' to 's', U+212A 'K' to 'k'). The guard reads
// `HostConfig.Privileged`, but Docker would also honour `hostconfig` or
// `PRIVILEGED` — and the guard forwards the parsed body as-is. So every object
// the guard inspects must spell each inspected field exactly, and carry no
// non-ASCII key at all. Pure.

const NON_ASCII = /[^\x20-\x7e]/;

/** Reason to refuse, or null. `fields` = the canonical names the guard reads. */
export function foldReason(obj, fields, where) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const canon = new Map(fields.map((f) => [f.toLowerCase(), f]));
  for (const key of Object.keys(obj)) {
    if (NON_ASCII.test(key)) return `${where} key ${JSON.stringify(key)} has non-ASCII characters`;
    const want = canon.get(key.toLowerCase());
    if (want !== undefined && want !== key) return `${where} key ${key} must be spelled ${want}`;
  }
  return null;
}

/** foldReason over a list of objects (Mounts entries). */
export function foldEach(list, fields, where) {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const r = foldReason(item, fields, where);
    if (r) return r;
  }
  return null;
}
