/**
 * ROK-2311 — three types split out of a shared row: `scheduling_poll` and
 * `lineup_lfg_offer` (out of `community_lineup`) and `voice_access_lost`
 * (out of `slot_vacated`). A notice under the new type must render exactly
 * as it did under the old one: same buttons, same fields, same defaults.
 */
import type { APIButtonComponentWithURL } from 'discord.js';
import { createDmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  DEFAULT_CHANNEL_PREFS,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import {
  buildInlineButtons,
  buildPrimaryButton,
} from './notification-embed.buttons';
import { addTypeSpecificFields } from './notification-embed.helpers';
import { resolveChannelPrefs } from './notification-mapping.helpers';
import { VOICE_ACCESS_LOST_SUBTYPE } from './voice-access-lost.helpers';

const CLIENT = 'https://raid.example';

/** [label, url] for primary + inline buttons, in send order. */
function row(
  type: NotificationType,
  payload: Record<string, unknown>,
): [string | undefined, string][] {
  const primary = buildPrimaryButton(type, 'n-1', payload, CLIENT);
  const buttons = [
    ...(primary ? [primary] : []),
    ...buildInlineButtons(type, payload, CLIENT),
  ];
  return buttons.map((b) => {
    const json = b.toJSON() as APIButtonComponentWithURL;
    return [json.label, json.url];
  });
}

/** [name, value] fields after addTypeSpecificFields. */
function fields(type: NotificationType, payload: Record<string, unknown>) {
  const embed = createDmEmbed({ state: 'announcing', timestamp: false });
  addTypeSpecificFields(embed, type, payload);
  return (embed.toJSON().fields ?? []).map((f) => [f.name, f.value]);
}

const poll = { lineupId: 7, matchId: 42, hubId: 12 };
const POLL_PAYLOADS: [string, Record<string, unknown>][] = [
  [
    'expiry warning (Lock)',
    {
      ...poll,
      subtype: 'scheduling_poll_expiry_warning',
      slotId: 9,
      lockLabel: 'Lock in Wed',
    },
  ],
  [
    'unanimous time (Lock)',
    { ...poll, subtype: 'scheduling_poll_unanimous_time', slotId: 9 },
  ],
  ['standalone poll', { ...poll, subtype: 'standalone_scheduling_poll' }],
  ['event rescheduling', { ...poll, subtype: 'event_rescheduling' }],
  ['scheduling open', { ...poll, subtype: 'lineup_scheduling_open' }],
];

describe('scheduling_poll buttons match community_lineup (ROK-2311)', () => {
  it.each(POLL_PAYLOADS)(
    '%s → same Vote/Lock/Open Poll/Hub row',
    (_n, payload) => {
      const old = row('community_lineup', payload);
      expect(old.length).toBeGreaterThan(1);
      expect(row('scheduling_poll', payload)).toEqual(old);
    },
  );

  it('a Lock DM under scheduling_poll carries the ?lock= link and Open Poll', () => {
    const [, payload] = POLL_PAYLOADS[0] ?? ['', {}];
    expect(row('scheduling_poll', payload).map(([label]) => label)).toEqual([
      'Lock in Wed',
      'Open Poll',
      'Hub',
    ]);
  });

  it('keeps the Game + Hub fields a poll DM had', () => {
    const payload = { ...poll, gameName: 'Valheim', hubName: 'Vikings' };
    expect(fields('scheduling_poll', payload)).toEqual([
      ['Game', 'Valheim'],
      ['Hub', '**Vikings**'],
    ]);
  });

  it('lineup_lfg_offer keeps the lineup button it had', () => {
    const payload = { lineupId: 7 };
    expect(row('lineup_lfg_offer', payload)).toEqual(
      row('community_lineup', payload),
    );
  });
});

describe('voice_access_lost Sign Up button (ROK-2311)', () => {
  it('links Sign Up to the event with the notification id', () => {
    const btn = buildPrimaryButton(
      'voice_access_lost',
      'n-42',
      { eventId: 5 },
      CLIENT,
    );
    const json = btn?.toJSON() as APIButtonComponentWithURL | undefined;
    expect([json?.label, json?.url]).toEqual([
      'Sign Up',
      `${CLIENT}/events/5?notif=n-42`,
    ]);
  });

  it('keeps the slot field + voice channel a slot_vacated DM had', () => {
    const payload = { eventId: 5, slotName: 'Tank 1' };
    expect(fields('voice_access_lost', payload)).toEqual(
      fields('slot_vacated', payload),
    );
    expect(fields('voice_access_lost', payload)).toEqual([['Slot', 'Tank 1']]);
  });

  it.each([
    'slot_vacated',
    'roster_reassigned',
    'tentative_displaced',
  ] as const)(
    'the voice subtype still relabels %s to Sign Up (permanent)',
    (type) => {
      const payload = { eventId: 5, subtype: VOICE_ACCESS_LOST_SUBTYPE };
      const btn = buildPrimaryButton(type, 'n-1', payload, CLIENT);
      const json = btn?.toJSON() as APIButtonComponentWithURL | undefined;
      expect(json?.label).toBe('Sign Up');
    },
  );
});

describe('split-type defaults (ROK-2311)', () => {
  it('scheduling_poll defaults to community_lineup; voice to slot_vacated', () => {
    expect(DEFAULT_CHANNEL_PREFS.scheduling_poll).toEqual(
      DEFAULT_CHANNEL_PREFS.community_lineup,
    );
    expect(DEFAULT_CHANNEL_PREFS.voice_access_lost).toEqual(
      DEFAULT_CHANNEL_PREFS.slot_vacated,
    );
  });

  it('lineup_lfg_offer is in-app only', () => {
    expect(DEFAULT_CHANNEL_PREFS.lineup_lfg_offer).toEqual({
      inApp: true,
      push: false,
      discord: false,
    });
  });

  it('an older stored row without the new keys resolves to the defaults', () => {
    const got = resolveChannelPrefs({
      community_lineup: { inApp: false, push: false, discord: false },
    });
    expect([
      got.scheduling_poll,
      got.lineup_lfg_offer,
      got.voice_access_lost,
    ]).toEqual([
      { inApp: true, push: true, discord: true },
      { inApp: true, push: false, discord: false },
      { inApp: true, push: true, discord: true },
    ]);
  });
});
