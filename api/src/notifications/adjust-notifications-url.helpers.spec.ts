/**
 * ROK-1797 §7 — the "Adjust Notifications" URL table, one row per input class.
 */
import { NOTIFICATION_TYPES } from '../drizzle/schema/notification-preferences';
import {
  buildAdjustNotificationsUrl,
  buildNotificationSettingsUrl,
  PER_GAME_NOTIFICATION_TYPES,
} from './adjust-notifications-url.helpers';

const CLIENT = 'https://raid.example.com';
const NOTIF = 'notif-abc';

const settingsRow = (type: string) =>
  `${CLIENT}/profile/notifications?type=${type}#notif-${type}`;

describe('PER_GAME_NOTIFICATION_TYPES', () => {
  it('is exactly the three per-game DM types', () => {
    expect([...PER_GAME_NOTIFICATION_TYPES].sort()).toEqual([
      'lfg_invite',
      'recruitment_reminder',
      'subscribed_game',
    ]);
  });
});

describe('buildAdjustNotificationsUrl — per-game types', () => {
  it.each(PER_GAME_NOTIFICATION_TYPES)(
    '%s with a numeric gameId → game page with the notif id',
    (type) => {
      expect(
        buildAdjustNotificationsUrl(type, { gameId: 42 }, NOTIF, CLIENT),
      ).toBe(`${CLIENT}/games/42?action=notifications&notif=${NOTIF}`);
    },
  );

  it('accepts a numeric-string gameId', () => {
    expect(
      buildAdjustNotificationsUrl('lfg_invite', { gameId: '7' }, NOTIF, CLIENT),
    ).toBe(`${CLIENT}/games/7?action=notifications&notif=${NOTIF}`);
  });

  it('omits &notif= when there is no notification id', () => {
    expect(
      buildAdjustNotificationsUrl(
        'subscribed_game',
        { gameId: 9 },
        undefined,
        CLIENT,
      ),
    ).toBe(`${CLIENT}/games/9?action=notifications`);
  });

  it('URI-encodes the notification id', () => {
    expect(
      buildAdjustNotificationsUrl(
        'subscribed_game',
        { gameId: 9 },
        'a&b c',
        CLIENT,
      ),
    ).toBe(`${CLIENT}/games/9?action=notifications&notif=a%26b%20c`);
  });

  it.each([
    ['missing', {}],
    ['no payload', undefined],
    ['zero', { gameId: 0 }],
    ['negative', { gameId: -3 }],
    ['fractional', { gameId: 1.5 }],
    ['non-numeric string', { gameId: 'wow' }],
    ['zero-padded string', { gameId: '07' }],
    ['null', { gameId: null }],
  ])('falls back to the settings row when gameId is %s', (_label, payload) => {
    expect(
      buildAdjustNotificationsUrl(
        'recruitment_reminder',
        payload,
        NOTIF,
        CLIENT,
      ),
    ).toBe(settingsRow('recruitment_reminder'));
  });
});

describe('buildAdjustNotificationsUrl — every other type', () => {
  const others = NOTIFICATION_TYPES.filter(
    (t) => !PER_GAME_NOTIFICATION_TYPES.includes(t),
  );

  it.each(others)('%s → its settings row, even with a gameId', (type) => {
    expect(
      buildAdjustNotificationsUrl(type, { gameId: 42 }, NOTIF, CLIENT),
    ).toBe(settingsRow(type));
  });

  it('standalone scheduling poll → the community_lineup row (OQ-1 default)', () => {
    expect(
      buildAdjustNotificationsUrl(
        'community_lineup',
        { subtype: 'standalone_scheduling_poll' },
        NOTIF,
        CLIENT,
      ),
    ).toBe(settingsRow('community_lineup'));
  });

  it('never targets the legacy preferences path', () => {
    for (const type of NOTIFICATION_TYPES) {
      const url = buildAdjustNotificationsUrl(
        type,
        { gameId: 1 },
        NOTIF,
        CLIENT,
      );
      expect(url).not.toContain('/profile/preferences/');
    }
  });
});

describe('buildNotificationSettingsUrl', () => {
  it('digest row: per-type anchor, no notif id', () => {
    expect(buildNotificationSettingsUrl(CLIENT, 'event_reminder')).toBe(
      settingsRow('event_reminder'),
    );
  });

  it('welcome row: the plain settings page', () => {
    expect(buildNotificationSettingsUrl(CLIENT)).toBe(
      `${CLIENT}/profile/notifications`,
    );
  });
});
