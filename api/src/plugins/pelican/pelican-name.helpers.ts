import type { GameServerEffect } from '@raid-ledger/contract';

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

/** `name` with every address-like token removed, trimmed to 200. */
function stripAddresses(name: string): string {
  let out = name;
  for (const pattern of PATTERNS) out = out.replace(pattern, ' ');
  return out
    .replace(EMPTY_BRACKETS, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .slice(0, MAX_NAME)
    .trim();
}

/** Safe display name; an empty result falls back to `Server <id>`. */
export function redactServerName(name: string, id: number): string {
  const out = stripAddresses(name);
  return out.length > 0 ? out : `Server ${id}`;
}

/** Member-facing fallback label per schedule effect (ROK-1096 ruling 1). */
export const SCHEDULE_EFFECT_LABELS: Readonly<
  Record<GameServerEffect, string>
> = {
  restart: 'Restart',
  stop: 'Stop',
  start: 'Server online',
  kill: 'Kill',
  backup: 'Backup',
  command: 'Command',
  mixed: 'Scheduled task',
};

/** Schedule name with addresses stripped; empty → the effect's label. */
export function redactScheduleLabel(
  name: string,
  effect: GameServerEffect,
): string {
  const out = stripAddresses(name);
  return out.length > 0 ? out : SCHEDULE_EFFECT_LABELS[effect];
}
