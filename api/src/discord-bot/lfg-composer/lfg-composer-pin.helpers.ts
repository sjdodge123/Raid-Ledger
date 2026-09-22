/**
 * ROK-1612 AC1 — the composer card as a REAL Discord pin.
 *
 * Operator ruling 2026-09-22 ("pin it"): the card is pinned, not re-posted to
 * stay last. That turns AC1 into an idempotency problem rather than a
 * placement one — every boot and every board enable runs this, and none of
 * them may stack a second card or a second pin:
 *
 *  1. **Find before you post.** The channel's pins are scanned for the bot's
 *     own message carrying the composer's `Post an LFG` custom id. Found, it is
 *     EDITED in place. There is no stored id to go stale — the pin list is the
 *     record, and a restore that loses `app_settings` cannot orphan the card.
 *  2. **An unpinned card is still ours.** A guild without Manage Messages gets
 *     an unpinned post (below); the next boot must adopt THAT one from recent
 *     history, not post another, or a missing permission becomes one extra
 *     card per restart.
 *  3. **Missing permission is logged once, never retried in a loop** (AC7).
 *     50013 is answered with one warning per channel per process and an
 *     unpinned card. Nothing here throws on a Discord refusal.
 *
 * Discord-free types on purpose: the fakes in the spec are the whole contract.
 */
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { LFG_COMPOSER_IDS } from './lfg-composer.constants';

/** How far back an unpinned card is looked for. Discord's fetch ceiling. */
export const LFG_COMPOSER_HISTORY_SCAN = 50;

/** Discord error codes that mean "you may not pin here" — not transient. */
const PIN_REFUSED_CODES = new Set([50013, 50001, 30003]);

/** The composer's rendered payload. */
export interface ComposerPayload {
  content?: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** The parts of a Discord message the pin flow reads and writes. */
export interface ComposerMessage {
  id: string;
  pinned: boolean;
  author: { id: string };
  components: ReadonlyArray<{
    components?: ReadonlyArray<{ customId?: string | null }>;
  }>;
  edit(payload: ComposerPayload): Promise<unknown>;
  pin(reason?: string): Promise<unknown>;
  delete(): Promise<unknown>;
}

/** The parts of a text channel the pin flow needs. */
export interface ComposerChannel {
  id: string;
  send(payload: ComposerPayload): Promise<ComposerMessage>;
  messages: {
    fetchPins(): Promise<{ items: ReadonlyArray<{ message: ComposerMessage }> }>;
    fetch(options: {
      limit: number;
    }): Promise<{ values(): Iterable<ComposerMessage> }>;
  };
}

/** What happened, for the log line and the assertions. */
export type ComposerPinOutcome =
  | 'edited-pinned'
  | 'adopted-pinned'
  | 'adopted-unpinned'
  | 'posted-pinned'
  | 'posted-unpinned';

export interface EnsureComposerDeps {
  channel: ComposerChannel;
  botUserId: string;
  payload: ComposerPayload;
  /** Receives the one-per-channel warning. */
  warn: (message: string) => void;
  /** Channels already warned about, so a refusal is logged once (AC7). */
  warned: Set<string>;
}

/** Every custom id on a message, flattened across its action rows. */
export function composerCustomIds(message: ComposerMessage): string[] {
  return message.components.flatMap((row) =>
    (row.components ?? []).flatMap((c) => (c.customId ? [c.customId] : [])),
  );
}

/** Whether a message is the bot's own composer card. */
export function isOwnComposer(
  message: ComposerMessage,
  botUserId: string,
): boolean {
  return (
    message.author.id === botUserId &&
    composerCustomIds(message).includes(LFG_COMPOSER_IDS.OPEN)
  );
}

/** The Discord error code on a rejection, when there is one. */
function errorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const { code } = err as { code: unknown };
  return typeof code === 'number' ? code : null;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pin a composer card, degrading to "left unpinned" on any refusal.
 *
 * @returns True when the card is now pinned.
 */
async function tryPin(
  message: ComposerMessage,
  deps: EnsureComposerDeps,
): Promise<boolean> {
  try {
    await message.pin('Raid Ledger LFG composer card');
    return true;
  } catch (err) {
    if (deps.warned.has(deps.channel.id)) return false;
    deps.warned.add(deps.channel.id);
    const code = errorCode(err);
    const why = code !== null && PIN_REFUSED_CODES.has(code)
      ? 'the bot lacks Manage Messages (or the channel is at its 50-pin cap)'
      : describe(err);
    deps.warn(
      `LFG composer card ${message.id} in channel ${deps.channel.id} could ` +
        `not be pinned: ${why}. It stays posted unpinned; grant the bot ` +
        'Manage Messages and restart it to pin the card.',
    );
    return false;
  }
}

/**
 * Delete composer cards beyond the kept one — a crashed earlier run's leak.
 * Best-effort: the bot may always delete its own messages, but a failure here
 * must not undo a successful edit.
 */
async function sweepExtras(extras: ComposerMessage[]): Promise<void> {
  for (const extra of extras) {
    await extra.delete().catch(() => undefined);
  }
}

/** The bot's own composer cards among the channel's pins, oldest pin first. */
async function pinnedComposers(
  deps: EnsureComposerDeps,
): Promise<ComposerMessage[]> {
  const pins = await deps.channel.messages.fetchPins();
  return pins.items
    .map((pin) => pin.message)
    .filter((m) => isOwnComposer(m, deps.botUserId))
    .reverse();
}

/** The bot's own unpinned composer cards in recent history. */
async function recentComposers(
  deps: EnsureComposerDeps,
): Promise<ComposerMessage[]> {
  const recent = await deps.channel.messages.fetch({
    limit: LFG_COMPOSER_HISTORY_SCAN,
  });
  return [...recent.values()].filter((m) => isOwnComposer(m, deps.botUserId));
}

/**
 * Ensure exactly one composer card exists in the channel, pinned if allowed.
 *
 * Order of preference: edit the pinned card → adopt (edit + pin) an unpinned
 * card from recent history → post a new one and pin it. Only the last branch
 * ever creates a message.
 *
 * @param deps - Channel, identity, payload and the once-only warning sink.
 * @returns What was done.
 */
export async function ensurePinnedComposer(
  deps: EnsureComposerDeps,
): Promise<ComposerPinOutcome> {
  const [kept, ...extraPins] = await pinnedComposers(deps);
  if (kept) {
    await kept.edit(deps.payload);
    await sweepExtras(extraPins);
    return 'edited-pinned';
  }
  const [adopted, ...extraRecent] = await recentComposers(deps);
  if (adopted) {
    await adopted.edit(deps.payload);
    await sweepExtras(extraRecent);
    return (await tryPin(adopted, deps)) ? 'adopted-pinned' : 'adopted-unpinned';
  }
  const posted = await deps.channel.send(deps.payload);
  return (await tryPin(posted, deps)) ? 'posted-pinned' : 'posted-unpinned';
}
