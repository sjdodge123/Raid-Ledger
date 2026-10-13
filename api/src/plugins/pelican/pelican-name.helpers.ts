/**
 * Member-facing server-name redaction (ROK-1772, ruling Q3). Panel names are
 * admin-typed and may carry an address; strip IPv4, IPv6, URLs, `host:port`,
 * uuids and 8-hex identifiers. The admin table shows the raw name.
 */
const PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\[[0-9a-f:.]+\](?::\d{1,5})?/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,
  /\b(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d{1,5}\b/gi,
  /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi,
  /::[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*/gi,
  // Full 8-group form only; compressed forms are the two `::` patterns above.
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi,
  // Single-label `host:port` (`nas:2456`). The label must hold a letter and
  // the port 2–5 digits, so times (`10:30`) and `Season 2: x` survive.
  /(?<![\w.:-])(?=[a-z0-9-]*[a-z])[a-z0-9-]+:\d{2,5}(?![\w:.])/gi,
  /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8}\b/gi,
];
const EMPTY_BRACKETS = /\(\s*\)|\[\s*\]|\{\s*\}/g;
const EDGE_PUNCTUATION = /^[\s\-:|@,/]+|[\s\-:|@,/]+$/g;
const MAX_NAME = 200;

/** Safe display name; an empty result falls back to `Server <id>`. */
export function redactServerName(name: string, id: number): string {
  let out = name;
  for (const pattern of PATTERNS) out = out.replace(pattern, ' ');
  out = out
    .replace(EMPTY_BRACKETS, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .slice(0, MAX_NAME)
    .trim();
  return out.length > 0 ? out : `Server ${id}`;
}
