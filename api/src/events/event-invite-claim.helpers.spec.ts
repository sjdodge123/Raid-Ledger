/**
 * ROK-2290 — a member invite follows the member's `new_event` switches the
 * way `NotificationService.create` does: bell on → visible row; bell off +
 * Discord on → hidden row (its id still drives the invite DM); both off → no
 * row, no DM. The lock + pending check (ROK-2217) are mocked here.
 */
import { claimMemberInvite } from './event-invite-claim.helpers';
import { hasPendingMemberInvite } from './event-invite-state.helpers';
import type { NotificationService } from '../notifications/notification.service';

jest.mock('./event-invite-state.helpers', () => ({
  ...jest.requireActual<object>('./event-invite-state.helpers'),
  hasPendingMemberInvite: jest.fn(),
}));

type Db = Parameters<typeof claimMemberInvite>[0];
const pending = jest.mocked(hasPendingMemberInvite);
const NOTICE = {
  eventId: 7,
  userId: 42,
  inviterName: 'Ann',
  eventTitle: 'Raid',
};

function fakeDb() {
  const values = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([{ id: 'n-1' }]),
  });
  const tx = {
    execute: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockReturnValue({ values }),
  };
  const db = {
    transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  } as unknown as Db;
  return { db, values };
}

function prefsService(newEvent: { inApp: boolean; discord: boolean }) {
  return {
    getPreferences: jest.fn().mockResolvedValue({
      userId: 42,
      channelPrefs: { new_event: { push: true, ...newEvent } },
    }),
  } as unknown as NotificationService;
}

describe('claimMemberInvite — bell vs Discord (ROK-2290)', () => {
  beforeEach(() => pending.mockResolvedValue(false));

  it('bell off + Discord on writes a HIDDEN row and returns its id', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: false, discord: true });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: 'n-1' });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ inAppHidden: true, type: 'new_event' }),
    );
    expect(values.mock.calls[0]?.[0]?.expiresAt).toBeInstanceOf(Date);
  });

  it('both switches off writes nothing and returns a null id', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: false, discord: false });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: null });
    expect(values).not.toHaveBeenCalled();
  });

  it('bell on writes a visible row with no expiry (unchanged)', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: true, discord: false });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: 'n-1' });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ inAppHidden: false, expiresAt: null }),
    );
  });

  it('a pending invite is not claimed and writes nothing', async () => {
    pending.mockResolvedValue(true);
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: false, discord: true });
    expect(await claimMemberInvite(db, svc, NOTICE)).toEqual({
      claimed: false,
    });
    expect(values).not.toHaveBeenCalled();
  });
});
