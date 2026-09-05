/**
 * ROK-1477 (Lane B) — the notification type -> embed STATE table.
 *
 * The deleted 19-entry map chose colour from notification TYPE — the two-axis
 * defect ROK-1449 exists to abolish. Its replacement maps a type to a named
 * lifecycle STATE and lets `colorForState` own the colour, so two types that
 * share a state necessarily share a colour.
 *
 * This spec is the ruling table from `planning-artifacts/specs/ROK-1477.md` §4
 * expressed as assertions: every one of the `NOTIFICATION_TYPES` (24 with ROK-1471's `lfg_invite`) has exactly
 * one state, and the `Record` is exhaustive so a new type is a `tsc` error
 * rather than a silent slate default.
 */
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import type { EmbedState } from '../discord-bot/embeds/embed-chrome.helpers';
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import {
  NOTIFICATION_EMBED_STATES,
  notificationEmbedState,
} from './notification-embed.helpers';

/** ROK-1477 §4, verbatim. `CHANGES` marks an operator-visible colour change. */
const RULING_TABLE: ReadonlyArray<[NotificationType, EmbedState]> = [
  ['slot_vacated', 'announcing'],
  ['event_reminder', 'needs_you'],
  ['new_event', 'announcing'],
  ['subscribed_game', 'announcing'],
  ['achievement_unlocked', 'done'], // CHANGES: emerald -> slate (A3)
  ['level_up', 'done'], // CHANGES: emerald -> slate (A3)
  ['missed_event_nudge', 'needs_you'],
  ['event_rescheduled', 'needs_you'],
  ['event_delayed', 'needs_you'],
  ['running_late', 'needs_you'],
  ['bench_promoted', 'live'],
  ['event_cancelled', 'cancelled'],
  ['roster_reassigned', 'done'],
  ['tentative_displaced', 'done'],
  ['member_returned', 'done'],
  ['recruitment_reminder', 'announcing'],
  ['role_gap_alert', 'needs_you'],
  ['lineup_steam_nudge', 'announcing'],
  ['community_lineup', 'announcing'],
  // ROK-1471: the LFG invite DM announces a group that just formed.
  ['lfg_invite', 'announcing'],
  ['user_deactivated_discord', 'done'],
  ['user_reactivated_discord', 'done'],
  ['post_event_followup', 'done'],
  ['system', 'done'],
];

describe('notificationEmbedState (ROK-1477 §4)', () => {
  it.each(RULING_TABLE)('maps %s to the %s state', (type, expected) => {
    expect(notificationEmbedState(type)).toBe(expected);
  });

  it('covers every NOTIFICATION_TYPE exactly once', () => {
    expect(RULING_TABLE.map(([type]) => type).sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });

  it('is an exhaustive Record — every type has a state at compile time', () => {
    // Compile-time half: this assignment only typechecks while the table is a
    // total `Record<NotificationType, EmbedState>`. Adding a member to
    // NOTIFICATION_TYPES without a state here fails `tsc --noEmit`.
    const exhaustive: Record<NotificationType, EmbedState> =
      NOTIFICATION_EMBED_STATES;
    // Runtime half: no key is missing and no stray key was invented.
    expect(Object.keys(exhaustive).sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });

  it('resolves colour through colorForState, never a type->colour map', () => {
    // The two CHANGES rows: these were emerald under the old type→colour map.
    expect(colorForState(notificationEmbedState('achievement_unlocked'))).toBe(
      EMBED_COLORS.SYSTEM,
    );
    expect(colorForState(notificationEmbedState('level_up'))).toBe(
      EMBED_COLORS.SYSTEM,
    );
    // Two types sharing a state necessarily share a colour — the property the
    // old 19-entry table could not enforce.
    expect(colorForState(notificationEmbedState('event_delayed'))).toBe(
      colorForState(notificationEmbedState('running_late')),
    );
  });
});
