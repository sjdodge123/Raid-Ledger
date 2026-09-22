/**
 * ROK-1619 — the indicator that marks the press which actually forms the group.
 *
 * Every `+1 · I'm in` looks identical today, but one of them is different: the
 * press that takes a game over {@link LFG_NOW_SPAWN_THRESHOLD} now-hands spawns
 * a live session on the spot. This module is the ONE place that decides when a
 * control carries that mark (AC7) — a second, subtly different predicate is the
 * failure mode the story exists to prevent.
 *
 * **It counts NOW-HANDS ONLY, because the spawn guard does.**
 * `spawnUnderGroupLock` compares `listLiveNowHands(...).length` against the
 * threshold, and `listLiveNowHands` filters `urgency = 'now'` exactly. The
 * counter this module reads (`LfmGroupView.nowCount`) is projected by
 * `groupColumns` (`lfg/lfg-query.helpers.ts`) as
 * `count(*) FILTER (WHERE urgency = 'now')` over the same eligible-and-live
 * intent set. So a `tonight` hand (ROK-1616) and a `week` hand contribute to
 * NEITHER, which is the agreement AC1 requires: the sun never promises a spawn
 * that the guard would then decline to perform.
 *
 * **AC2 — resolved: the board card is a per-CARD approximation, by necessity.**
 * A forum post is a single shared message; Discord renders one component row to
 * every viewer, so the button genuinely cannot vary per person. The board
 * therefore asks {@link pressWouldSpawnNow} WITHOUT a viewer, which answers
 * "the next new now-hand forms the group" — true for anyone not already holding
 * one, and the reason {@link LFG_NOW_SPAWN_BUTTON_LABEL} is worded as a
 * property of the press rather than a promise to the reader. Surfaces that DO
 * know their viewer (an invite DM, the web group page, an ephemeral reply) pass
 * `viewerHoldsNowHand` and get the strict per-viewer answer AC1 describes. One
 * predicate, one optional refinement — not two implementations.
 */
import { LFG_NOW_SPAWN_THRESHOLD } from './lfg-now.constants';

/**
 * The default indicator emoji: 🎉 (operator ruling 2026-09-22, replacing ☀️).
 *
 * Used whenever no emoji is configured (`lfg_now_indicator_emoji` unset) or
 * the configured custom emoji is not usable here. Unicode, so it renders in
 * every guild, every DM and on the web.
 */
export const LFG_NOW_INDICATOR_UNICODE = '🎉';

/**
 * AC6 — the meaning must survive someone who does not recognise the emoji.
 *
 * The emoji is reinforcement; this label is the message. Deliberately phrased
 * as what the PRESS does ("starts the group"), not as what the reader will do,
 * because of the per-card approximation documented above. Well inside Discord's
 * 80-character button-label cap.
 */
export const LFG_NOW_SPAWN_BUTTON_LABEL = "+1 · I'm in · starts the group";

/** The slice of a rendered group this decision actually depends on. */
export interface LfgNowIndicatorInputs {
  /** `LfmRenderState`. Only an `open` group has a press left to make. */
  state: string;
  /** Live `urgency = 'now'` hands. Absent means none (a week-only group). */
  nowCount?: number;
  /**
   * The already-spawned session, when there is one. Set at `playing`; belt and
   * braces against a view that reports a live event on an `open` state during
   * the window between the spawn commit and the re-render (AC3).
   */
  playingEventId?: number | null;
  /**
   * Does THIS viewer already hold a live now-hand? Their press is idempotent,
   * so it cannot cross anything — AC1. `undefined` means the surface has no
   * viewer to ask about (the shared board card), NOT "no".
   */
  viewerHoldsNowHand?: boolean;
}

/**
 * Would the next press form the group?
 *
 * @param inputs - The group's render state, its live now-hand count, and the
 *   viewer's own now-hand where the surface knows it.
 * @returns True only when a new now-hand would cross the spawn threshold.
 */
export function pressWouldSpawnNow(inputs: LfgNowIndicatorInputs): boolean {
  // A scheduled, expired, closed or already-`playing` group has nothing left to
  // trigger, and a live event on the view says the spawn already happened —
  // AC3's "a card still showing the sun after someone else triggered it is a
  // lie", enforced by the predicate rather than by remembering to re-render.
  if (inputs.state !== 'open') return false;
  if (inputs.playingEventId != null) return false;
  if (inputs.viewerHoldsNowHand === true) return false;
  // EXACTLY one short, not "one or more short". At or above the threshold the
  // spawn has already fired (or is mid-flight under the group advisory lock),
  // so the honest answer is no — this press would ATTACH to the open session,
  // which is a different thing and must not wear the mark.
  return (inputs.nowCount ?? 0) === LFG_NOW_SPAWN_THRESHOLD - 1;
}

/** Component-shaped emoji: `{ id, name }` custom, or `{ name }` Unicode. */
export interface LfgNowIndicatorEmoji {
  id?: string;
  name: string;
}

/** The minimum a guild emoji has to look like to be usable here. */
export interface GuildEmojiLike {
  id: string;
  name: string | null;
  /** discord.js sets this false when the guild lost the boost tier for it. */
  available?: boolean | null;
}

/** A guild's emoji collection, structurally — no discord.js import needed. */
export interface EmojiCacheLike {
  find(
    predicate: (emoji: GuildEmojiLike) => boolean,
  ): GuildEmojiLike | undefined;
}

/** `<:name:id>`, `<a:name:id>`, `:name:` or a bare `name` — a CUSTOM emoji. */
const CUSTOM_EMOJI_RE = /^(?:<a?:(\w{2,32}):(\d{5,25})>|:?(\w{2,32}):?)$/;

/**
 * THE indicator-emoji resolver (AC5, ROK-1619 emoji setting) — the one
 * function the board card, the invite DM's Join button and the web group read
 * all go through.
 *
 * - unset / blank → 🎉 ({@link LFG_NOW_INDICATOR_UNICODE});
 * - a Unicode emoji → used as is;
 * - a custom emoji (`<:name:id>`, `:name:` or `name`) → looked up in the
 *   guild's cache by id, then by name, and used only when discord.js does not
 *   report it unavailable; otherwise 🎉. With no cache (a DM, the web, a
 *   client that is not ready) a custom emoji cannot be verified, so it is 🎉.
 *
 * Returning COMPONENT data rather than a formatted string keeps AC5
 * structural: `ButtonBuilder.setEmoji` takes `{ id?, name }`, so no path here
 * can surface a raw `<:name:id>` as visible text.
 *
 * @param configured - The admin setting's raw value, or null when unset.
 * @param cache - `guild.emojis.cache`, or null when there is no usable guild.
 * @returns Always a usable emoji component.
 */
export function resolveNowIndicatorEmoji(
  configured: string | null | undefined,
  cache?: EmojiCacheLike | null,
): LfgNowIndicatorEmoji {
  const value = configured?.trim() ?? '';
  if (!value) return { name: LFG_NOW_INDICATOR_UNICODE };
  const custom = CUSTOM_EMOJI_RE.exec(value);
  if (!custom) return { name: value };
  const found = findCustomEmoji(cache, custom[2], custom[1] ?? custom[3]);
  if (found && found.name && found.available !== false) {
    return { id: found.id, name: found.name };
  }
  return { name: LFG_NOW_INDICATOR_UNICODE };
}

/** Look a custom emoji up by id first (exact), then by name. */
function findCustomEmoji(
  cache: EmojiCacheLike | null | undefined,
  id: string | undefined,
  name: string,
): GuildEmojiLike | null {
  if (!cache) return null;
  if (id) return cache.find((emoji) => emoji.id === id) ?? null;
  return cache.find((emoji) => emoji.name === name) ?? null;
}

/** The slice of a group read (`LfgGroupSummaryDto`) the predicate needs. */
export interface LfgGroupReadLike {
  nowCount: number;
  playingNow: { eventId: number } | null;
}

/**
 * {@link pressWouldSpawnNow} for surfaces that hold a group READ rather than
 * a board render state — the web group page and the invite DM (AC7).
 *
 * An adapter, not a second predicate: a group with no live session is the
 * board's `open` state, and the session's event id is `playingEventId`. The
 * decision itself stays in {@link pressWouldSpawnNow}.
 *
 * @param group - The group read (live now-hands + the live session, if any).
 * @param viewerHoldsNowHand - Whether THIS viewer already holds a now-hand.
 * @returns True only when the viewer's new now-hand would form the group.
 */
export function groupReadPressWouldSpawnNow(
  group: LfgGroupReadLike,
  viewerHoldsNowHand: boolean,
): boolean {
  return pressWouldSpawnNow({
    state: group.playingNow ? 'playing' : 'open',
    nowCount: group.nowCount,
    playingEventId: group.playingNow?.eventId ?? null,
    viewerHoldsNowHand,
  });
}
