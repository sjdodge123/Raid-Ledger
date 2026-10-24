/**
 * ROK-1896 D6/D7 — a hub poll's DM carries one `Hub` Link button (after the
 * inline links, before Adjust Notifications) and a `Hub` field naming it.
 */
import type { APIButtonComponentWithURL } from 'discord.js';
import { createDmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  buildInlineButtons,
  buildPrimaryButton,
} from './notification-embed.buttons';
import { addTypeSpecificFields } from './notification-embed.helpers';

const CLIENT = 'https://raid.example';
const HUB = `${CLIENT}/hubs/12`;
const POLL = `${CLIENT}/community-lineup/7/schedule/42`;

/** [label, url] for primary + inline buttons, in the order the row sends them. */
function row(payload: Record<string, unknown>): [string | undefined, string][] {
  const primary = buildPrimaryButton(
    'community_lineup',
    'n-1',
    payload,
    CLIENT,
  );
  const buttons = [
    ...(primary ? [primary] : []),
    ...buildInlineButtons('community_lineup', payload, CLIENT),
  ];
  return buttons.map((b) => {
    const json = b.toJSON() as APIButtonComponentWithURL;
    return [json.label, json.url];
  });
}

const poll = { lineupId: 7, matchId: 42 };

describe('poll DM Hub button (ROK-1896 D7)', () => {
  it.each([
    ['standalone_scheduling_poll', 'Vote on a Time'],
    ['standalone_scheduling_poll_reminder', 'Vote on a Time'],
    ['event_rescheduling', 'Vote Now'],
  ])('%s → [%s][Hub]', (subtype, label) => {
    expect(row({ ...poll, subtype, hubId: 12 })).toEqual([
      [label, POLL],
      ['Hub', HUB],
    ]);
  });

  it('lineup_event_created (bench / auto-signup / result) → [View Event][Hub]', () => {
    const payload = { subtype: 'lineup_event_created', eventId: 3, hubId: 12 };
    expect(row(payload)).toEqual([
      ['View Event', `${CLIENT}/events/3`],
      ['Hub', HUB],
    ]);
  });

  it('lineup_event_created with a lineupId → [View Event][View Lineup][Hub]', () => {
    const payload = {
      subtype: 'lineup_event_created',
      eventId: 3,
      lineupId: 7,
      hubId: 12,
    };
    expect(row(payload).map(([label]) => label)).toEqual([
      'View Event',
      'View Lineup',
      'Hub',
    ]);
  });

  it('a lock DM with a hub → [Lock][Open Poll][Hub]', () => {
    const payload = {
      ...poll,
      subtype: 'scheduling_poll_expiry_warning',
      slotId: 9,
      lockLabel: 'Lock in Wed 7:00 PM',
      hubId: 12,
    };
    expect(row(payload)).toEqual([
      ['Lock in Wed 7:00 PM', `${POLL}?lock=9`],
      ['Open Poll', POLL],
      ['Hub', HUB],
    ]);
  });
});

describe('poll DM Hub button — only a valid hubId (ROK-1896 D6)', () => {
  it('adds no Hub button without a hubId', () => {
    const labels = row({ ...poll, subtype: 'standalone_scheduling_poll' }).map(
      ([label]) => label,
    );
    expect(labels).toEqual(['Vote on a Time']);
  });

  it.each([['5'], [-1], [1.5], [0], [Number.MAX_SAFE_INTEGER + 2]])(
    'adds no Hub button for hubId %p',
    (hubId) => {
      const labels = row({
        ...poll,
        subtype: 'standalone_scheduling_poll',
        hubId,
      }).map(([label]) => label);
      expect(labels).not.toContain('Hub');
    },
  );

  it('adds no Hub button on a non-lineup notification type', () => {
    const buttons = buildInlineButtons(
      'lineup_steam_nudge',
      { hubId: 12 },
      CLIENT,
    );
    expect(buttons).toEqual([]);
  });
});

/** The embed's fields after addTypeSpecificFields for a community_lineup DM. */
function fields(payload: Record<string, unknown>) {
  const embed = createDmEmbed({ state: 'announcing', timestamp: false });
  addTypeSpecificFields(embed, 'community_lineup', payload);
  return embed.toJSON().fields ?? [];
}

describe('poll DM Hub field (ROK-1896 D6)', () => {
  it('names the hub in a bold `Hub` field after Game', () => {
    const got = fields({ gameName: 'Valheim', hubId: 12, hubName: 'Vikings' });
    expect(got.map((f) => [f.name, f.value])).toEqual([
      ['Game', 'Valheim'],
      ['Hub', '**Vikings**'],
    ]);
  });

  it('escapes markdown links and defangs @mentions in the name', () => {
    const got = fields({ hubName: '[x](https://e) @everyone' });
    const hub = got.find((f) => f.name === 'Hub');
    expect(hub?.value).toBe('**\\[x](https://e) @\u200beveryone**');
  });

  it('adds no Hub field without a hubName', () => {
    expect(
      fields({ gameName: 'Valheim', hubId: 12 }).map((f) => f.name),
    ).toEqual(['Game']);
  });
});
