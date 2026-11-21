import {
  CALENDAR_RECONNECT_PATH,
  buildCalendarReconnectButton,
  buildReconnectNudgeInput,
  claimReconnectNudge,
} from './calendar-reconnect-nudge.helpers';

function makeDb(returned: unknown[]) {
  const returning = jest.fn().mockResolvedValue(returned);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  return { db: { update } as never, set, where, returning };
}

describe('buildReconnectNudgeInput (ROK-1866 D5)', () => {
  it.each([
    ['google', 'Google'],
    ['microsoft', 'Microsoft'],
  ])(
    'names the %s provider and deep-links the Integrations page',
    (provider, label) => {
      const input = buildReconnectNudgeInput({ userId: 7, provider }, 3);
      expect(input).toEqual({
        userId: 7,
        type: 'calendar_needs_reconnect',
        title: `Reconnect your ${label} calendar`,
        message: `Raid Ledger lost access to your ${label} calendar, so game nights aren't syncing. Reconnect it on your Integrations page.`,
        payload: { connectionId: 3, provider, url: '/profile/integrations' },
      });
    },
  );

  it('tells an Apple member the app-specific password was revoked', () => {
    const input = buildReconnectNudgeInput({ userId: 7, provider: 'apple' }, 4);
    expect(input.title).toBe('Reconnect your iCloud calendar');
    expect(input.message).toBe(
      "Your app-specific password was revoked, so your iCloud calendar isn't syncing. Reconnect it with a new password.",
    );
    expect(input.payload?.url).toBe(CALENDAR_RECONNECT_PATH);
  });
});

describe('buildCalendarReconnectButton', () => {
  it('links "Reconnect calendar" to the absolute Integrations URL', () => {
    const json = buildCalendarReconnectButton(
      undefined,
      'https://raid.example',
    ).toJSON() as { label?: string; url?: string };
    expect(json.label).toBe('Reconnect calendar');
    expect(json.url).toBe('https://raid.example/profile/integrations');
  });
});

describe('claimReconnectNudge (ROK-1866 D1)', () => {
  it('returns the claimed row and stamps reconnect_nudged_at', async () => {
    const { db, set } = makeDb([{ userId: 7, provider: 'google' }]);
    await expect(claimReconnectNudge(db, 3)).resolves.toEqual({
      userId: 7,
      provider: 'google',
    });
    const setArg = set.mock.calls[0]?.[0] as { reconnectNudgedAt?: unknown };
    expect(setArg.reconnectNudgedAt).toBeInstanceOf(Date);
  });

  it('returns null when the episode was already claimed (no row matched)', async () => {
    const { db } = makeDb([]);
    await expect(claimReconnectNudge(db, 3)).resolves.toBeNull();
  });
});
