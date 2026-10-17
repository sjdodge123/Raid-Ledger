/**
 * ROK-1507 — smoke channel pools are built from Discord channel TYPE and
 * exclude ephemeral channels. Never from name or list position.
 *
 * Why: the API's /admin/settings/discord-bot/channels list is filtered with
 * `isTextBased()`, which in discord.js v14 is TRUE for voice channels (they
 * carry text chat), so the "text" list also contains every voice channel.
 * Both API lists sort by name and ICU collation puts '⏰' before letters, so
 * an orphaned ephemeral voice channel ('⏰ <game> — Playing now', left by a
 * ROK-1494 fleet gate) became index 0 of BOTH pools — the default
 * notification channel AND the default voice channel were the same voice
 * channel, and 19/124 companion-smoke tests failed on every PR.
 *
 * Pure module on purpose: no discord.js import, so channel-set.ts and the
 * specs stay dependency-free. The ChannelType values are stable Discord API
 * constants (mirrors series-dual-binding.test.ts).
 */

/** discord.js ChannelType.GuildText. */
export const GUILD_TEXT = 0;
/** discord.js ChannelType.GuildVoice. */
export const GUILD_VOICE = 2;

export interface TypedChannel {
  id: string;
  name: string;
  /** discord.js ChannelType, read from the harness guild cache. */
  type?: number;
}

export interface SkippedChannel {
  id: string;
  name: string;
  reason: string;
}

export interface ChannelPools<T extends TypedChannel> {
  textChannels: T[];
  voiceChannels: T[];
  skipped: SkippedChannel[];
}

/** Ephemeral voice channels the API creates for a live event (ROK-1352/1494). */
const EPHEMERAL_MARKER = '⏰';
/** Older smoke fixtures: `uid('smoke-rok1352-ephemeral')` and friends. */
const EPHEMERAL_SMOKE_RE = /^smoke-.*-ephemeral/i;

/**
 * The ONE predicate for "this channel is ephemeral and must never be picked
 * by a smoke fixture". Used by pool building AND selectChannelSet.
 */
export function isEphemeralChannelName(name: string): boolean {
  const n = name.trimStart();
  return n.startsWith(EPHEMERAL_MARKER) || EPHEMERAL_SMOKE_RE.test(n);
}

/** Drop ephemeral channels; returns the same object references. */
export function filterEphemeral<T extends { name: string }>(channels: T[]): T[] {
  return channels.filter((c) => !isEphemeralChannelName(c.name));
}

/**
 * Assert a channel is a GuildText channel, failing loudly with its name and
 * type otherwise — a voice id must never become the default notification
 * channel again.
 */
export function requireTextChannel<T extends TypedChannel>(
  ch: T | undefined,
  role: string,
): T {
  if (ch !== undefined && ch.type === GUILD_TEXT) return ch;
  throw new Error(
    `${role}: expected a GuildText channel (type ${GUILD_TEXT}) but got ` +
      `"${ch?.name ?? 'none'}" (${ch?.id ?? 'no id'}) type=${ch?.type ?? 'unknown'}`,
  );
}

/** The API text and voice lists overlap (see module doc) — keep first by id. */
function dedupeById<T extends { id: string }>(channels: T[]): T[] {
  const seen = new Set<string>();
  return channels.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

/**
 * Route channels into text / voice pools by their real Discord type.
 * Ephemeral names are skipped (reason 'ephemeral'); a channel whose type is
 * unknown, or is neither text nor voice (category, forum, stage), is skipped
 * with reason `type=<n|unknown>` — it is never guessed from its name.
 */
export function buildChannelPools<T extends TypedChannel>(
  channels: T[],
  typeOf: (id: string) => number | undefined,
): ChannelPools<T> {
  const pools: ChannelPools<T> = { textChannels: [], voiceChannels: [], skipped: [] };
  for (const raw of dedupeById(channels)) {
    const ch: T = { ...raw, type: typeOf(raw.id) };
    if (isEphemeralChannelName(ch.name)) {
      pools.skipped.push({ id: ch.id, name: ch.name, reason: 'ephemeral' });
    } else if (ch.type === GUILD_TEXT) {
      pools.textChannels.push(ch);
    } else if (ch.type === GUILD_VOICE) {
      pools.voiceChannels.push(ch);
    } else {
      pools.skipped.push({ id: ch.id, name: ch.name, reason: `type=${ch.type ?? 'unknown'}` });
    }
  }
  return pools;
}
