/**
 * ROK-1462 / ROK-1448 — the single source of truth for channel-binding copy.
 *
 * The `/bind` slash-command reply and the admin binding form describe the SAME
 * settings, and the acceptance criteria require them to describe them in the
 * same words. Two hand-synced literals in two workspaces drift; one constant
 * imported by both cannot. `api` and `web` may not import each other, but both
 * already depend on `@raid-ledger/contract`, so this is where the copy lives.
 *
 * Behaviour these words describe (read before editing any of them):
 * - `minPlayers` is a per-detected-game-group threshold on a general lobby and a
 *   channel-occupancy threshold on a game voice monitor (ROK-1445, PR #1069 —
 *   `api/src/discord-bot/listeners/voice-lobby-groups.helpers.ts`).
 * - Auto-close is per EVENT GROUP: the grace period starts when that event's own
 *   member set empties, not when the channel does
 *   (`api/src/discord-bot/services/ad-hoc-event.service.ts`).
 */
import type { z } from 'zod';
import type { BindingPurposeEnum } from './channel-bindings.schema.js';

type BindingPurpose = z.infer<typeof BindingPurposeEnum>;

/** Purpose labels, worded identically in the reply and the form's purpose select. */
export const BINDING_PURPOSE_LABELS: Record<BindingPurpose, string> = {
  'game-announcements': 'Announcements',
  'game-voice-monitor': 'Activity Monitor',
  'general-lobby': 'General Lobby',
  'lfg-board': 'LFG board',
};

/**
 * What a minimum-player count counts, per purpose. A general lobby groups by
 * detected game, so the threshold is per game; an activity monitor is already
 * game-scoped, so it counts everyone in the channel.
 */
export const MIN_PLAYERS_UNIT: Record<BindingPurpose, string> = {
  'general-lobby': 'per game',
  'game-voice-monitor': 'in channel',
  // Announcements never render the field; kept total so the map cannot drift.
  'game-announcements': 'per game',
  // The board has no threshold; its unit noun names what it posts instead.
  'lfg-board': 'per forming group',
};

/** Field/label noun for the minimum-player threshold. */
export const MIN_PLAYERS_LABEL = 'Minimum players';

/** Field/label noun for the auto-close setting. */
export const AUTO_CLOSE_LABEL = 'Auto-close';

/** What auto-close waits for. Per event group, never per channel. */
export const AUTO_CLOSE_TRIGGER_NOUN = 'after group empties';

/** Field/label noun for the general-lobby "Just Chatting" allowance. */
export const JUST_CHATTING_LABEL = 'Just Chatting';

/** Purpose-aware explanation of what the threshold counts (ROK-1448). */
export const MIN_PLAYERS_HELP: Record<BindingPurpose, string> = {
  'general-lobby':
    'Counted per detected game, not per channel. Members whose game Discord ' +
    'cannot see are not counted at all unless "Just Chatting" is allowed.',
  'game-voice-monitor':
    'Counted in the channel. Everyone connected counts toward the bound game, ' +
    'including members whose game Discord cannot see.',
  'game-announcements': '',
  'lfg-board':
    'A forum channel the bot posts one thread per forming group into. The bot ' +
    'normally creates and manages this channel itself — bind one only to ' +
    'override that with an existing forum.',
};

/**
 * The consequence an operator would otherwise file as a bug (ROK-1448).
 * Intentionally states the number so it reads as a worked example.
 */
export const MIN_PLAYERS_CONSEQUENCE =
  'At a minimum of 2 per game, a channel where everyone is playing something ' +
  'different produces no events at all — five people across three games is ' +
  'zero events. That is intended, not a fault.';

/** Auto-close scope, in the words both surfaces use (ROK-1448). */
export const AUTO_CLOSE_HELP =
  'Closing is per event group, not per channel: an event closes once its own ' +
  'group empties, after the grace period below. Other groups in the same ' +
  'channel keep running.';

/**
 * The minimum-players form label for a purpose, e.g. `Minimum players (per game)`.
 *
 * @param purpose - The binding's resolved purpose.
 * @returns The label, carrying the same unit noun the `/bind` reply renders.
 */
export function minPlayersLabel(purpose: BindingPurpose): string {
  return `${MIN_PLAYERS_LABEL} (${MIN_PLAYERS_UNIT[purpose]})`;
}

/**
 * The auto-close form label, e.g. `Auto-close after group empties`.
 *
 * @returns The label, carrying the same trigger noun the `/bind` reply renders.
 */
export function autoCloseLabel(): string {
  return `${AUTO_CLOSE_LABEL} ${AUTO_CLOSE_TRIGGER_NOUN}`;
}
