/**
 * ROK-2290 operator ruling 2026-11-23 — invites keep the old rule: the
 * `new_event` bell off means no invite at all (no row, so no invite DM),
 * whatever the Discord switch says. Bell on → visible row whose id drives the
 * DM. The lock + pending check (ROK-2217) are mocked here.
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

  it('bell off + Discord on writes nothing and returns a null id (no invite DM)', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: false, discord: true });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: null });
    expect(values).not.toHaveBeenCalled();
  });

  it('both switches off writes nothing and returns a null id', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: false, discord: false });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: null });
    expect(values).not.toHaveBeenCalled();
  });

  it('bell on writes a visible new_event row with no expiry and returns its id', async () => {
    const { db, values } = fakeDb();
    const svc = prefsService({ inApp: true, discord: false });
    const claim = await claimMemberInvite(db, svc, NOTICE);
    expect(claim).toEqual({ claimed: true, notificationId: 'n-1' });
    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({ type: 'new_event', userId: 42 });
    expect(row.inAppHidden).not.toBe(true);
    expect(row.expiresAt ?? null).toBeNull();
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
