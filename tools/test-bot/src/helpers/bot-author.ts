/**
 * ROK-1469 — author filtering for the Discord smoke suite.
 *
 * Every fleet env runs its OWN Discord application (one per runner slot), so
 * two envs sharing a guild can post structurally identical embeds. Without a
 * filter, slot-1's embed can satisfy a slot-2 assertion — a false PASS, which
 * is worse than any timeout. `readLastMessages` therefore pins its results to
 * the bot the env under test is actually running as.
 *
 * FAIL-OPEN is deliberate: when the id cannot be resolved (bot not connected,
 * `SMOKE_BOT_USER_ID` unset, an API build predating `botUserId`), nothing is
 * filtered. A *wrong* filter id would hide every real message and surface as
 * a mass timeout with no clue why.
 */

/** Minimal shape of the message objects the filter inspects. */
export interface AuthoredMessage {
  authorId: string;
}

/** Minimal shape of the smoke ApiClient this module needs. */
export interface BotStatusReader {
  get(path: string): Promise<unknown>;
}

/** Bot-status endpoint carrying the running identity (ROK-1469 API side). */
export const BOT_STATUS_PATH = '/admin/settings/discord-bot';

let apiBotUserId: string | null = null;

/**
 * Set (or clear, with null) the Discord user id every channel read is pinned
 * to. Called once at smoke startup after {@link resolveApiBotUserId}.
 */
export function setApiBotUserId(id: string | null): void {
  apiBotUserId = id && id.trim() !== '' ? id.trim() : null;
}

/** The currently pinned bot user id, or null when filtering is disabled. */
export function getApiBotUserId(): string | null {
  return apiBotUserId;
}

/** True when the message came from the pinned bot — or when none is pinned. */
export function isFromApiBot(msg: AuthoredMessage): boolean {
  if (apiBotUserId === null) return true;
  return msg.authorId === apiBotUserId;
}

/**
 * Gate for EVENT-driven waits (`waitForMessage`, `waitForEmbedUpdate`): may a
 * message from this author satisfy the wait? Same rule as the polled reads —
 * without it an event-driven wait could be resolved by a SIBLING fleet env's
 * bot posting into the same channel while the polled path filtered it out.
 */
export function shouldAcceptMessage(msg: AuthoredMessage): boolean {
  return isFromApiBot(msg);
}

/** Keep only messages authored by the pinned bot (all of them when unpinned). */
export function filterByApiBot<T extends AuthoredMessage>(msgs: T[]): T[] {
  if (apiBotUserId === null) return msgs;
  return msgs.filter((m) => m.authorId === apiBotUserId);
}

/**
 * Resolve the API's bot user id: the `SMOKE_BOT_USER_ID` env override first
 * (local runs against a bot the status endpoint can't see), then the bot
 * status endpoint. Never throws — an unreachable or older API yields null,
 * which disables filtering rather than breaking the run.
 */
export async function resolveApiBotUserId(
  api: BotStatusReader,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const override = (env.SMOKE_BOT_USER_ID ?? '').trim();
  if (override !== '') return override;
  try {
    const status = (await api.get(BOT_STATUS_PATH)) as { botUserId?: string } | null;
    const id = (status?.botUserId ?? '').trim();
    return id === '' ? null : id;
  } catch {
    return null;
  }
}
