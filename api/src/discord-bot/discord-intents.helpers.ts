/**
 * ROK-1703: privileged-intent detection for the Discord setup wizard.
 *
 * Discord reports which privileged intents an application has switched on
 * through the `flags` of `GET /applications/@me` (Bot auth). Each intent has
 * two bits: the plain one for verified apps (100+ servers) and the `_LIMITED`
 * one that the Developer Portal's Bot-page switch sets for apps in fewer than
 * 100 servers. Either bit means "on". Bit values confirmed 2026-10-30 against
 * https://docs.discord.com/developers/resources/application (Application Flags).
 */
import {
  PRIVILEGED_INTENT_LABELS,
  type PrivilegedIntent,
} from '@raid-ledger/contract';

const DISCORD_API = 'https://discord.com/api/v10';
const PREFLIGHT_TIMEOUT_MS = 5000;

/** [intent, GATEWAY_* bit, GATEWAY_*_LIMITED bit] in portal order. */
const INTENT_FLAG_BITS: readonly [PrivilegedIntent, number, number][] = [
  ['presence', 1 << 12, 1 << 13],
  ['guildMembers', 1 << 14, 1 << 15],
  ['messageContent', 1 << 18, 1 << 19],
];

/** Every privileged intent Raid Ledger requests, in portal order. */
export const ALL_PRIVILEGED_INTENTS: readonly PrivilegedIntent[] =
  INTENT_FLAG_BITS.map(([intent]) => intent);

/** The privileged intents whose bits (plain or limited) are both clear. */
export function missingIntentsFromFlags(flags: number): PrivilegedIntent[] {
  return INTENT_FLAG_BITS.filter(
    ([, full, limited]) => (flags & full) === 0 && (flags & limited) === 0,
  ).map(([intent]) => intent);
}

/**
 * Ask Discord which privileged intents the token's application lacks.
 * Returns null when the call fails (bad token, network, odd body) — callers
 * treat that as "unknown", never as "all on".
 */
export async function fetchMissingPrivilegedIntents(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PrivilegedIntent[] | null> {
  try {
    const res = await fetchImpl(`${DISCORD_API}/applications/@me`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { flags?: unknown };
    if (typeof body.flags !== 'number') return null;
    return missingIntentsFromFlags(body.flags);
  } catch {
    return null;
  }
}

/**
 * The application id a bot token belongs to: its first segment is the bot
 * user's id, base64-encoded, and a bot user shares its application's id.
 * Null when the segment does not decode to a snowflake.
 */
export function applicationIdFromToken(token: string): string | null {
  const first = token.trim().split('.')[0];
  if (!first) return null;
  const decoded = Buffer.from(first, 'base64url').toString('utf8');
  return /^\d{17,20}$/.test(decoded) ? decoded : null;
}

/** "Presence Intent and Message Content Intent" (all three when empty). */
export function describeMissingIntents(
  list: readonly PrivilegedIntent[] | null | undefined,
): string {
  const intents = list && list.length > 0 ? list : ALL_PRIVILEGED_INTENTS;
  const labels = intents.map((i) => PRIVILEGED_INTENT_LABELS[i]);
  if (labels.length === 1) return labels[0] ?? '';
  const last = labels[labels.length - 1] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${last}`;
}
