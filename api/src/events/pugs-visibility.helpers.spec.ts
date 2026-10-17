import type { PugSlotResponseDto } from '@raid-ledger/contract';
import {
  canManageEvent,
  projectPugSlotsForViewer,
} from './pugs-visibility.helpers';

const SLOT: PugSlotResponseDto = {
  id: '3f0e7f0a-7d0f-4a55-9d53-1f4b8d2c9a11',
  eventId: 7,
  discordUsername: 'guest',
  discordUserId: '123456789012345678',
  discordAvatarHash: 'abc',
  role: 'dps',
  class: null,
  spec: null,
  notes: null,
  status: 'invited',
  serverInviteUrl: 'https://discord.gg/example',
  inviteCode: 'CODE1234',
  claimedByUserId: null,
  createdBy: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('canManageEvent (ROK-1825)', () => {
  it.each([
    ['creator', 5, false, true],
    ['operator/admin', 9, true, true],
    ['other member', 9, false, false],
  ] as const)('%s → %s', (_l, userId, isAdmin, expected) => {
    expect(canManageEvent(5, userId, isAdmin)).toBe(expected);
  });
});

describe('projectPugSlotsForViewer (ROK-1825)', () => {
  it('nulls the invite code and guild invite for a non-manager', () => {
    const [out] = projectPugSlotsForViewer([SLOT], 5, {
      id: 9,
      isAdmin: false,
    });
    expect(out).toEqual({ ...SLOT, inviteCode: null, serverInviteUrl: null });
  });

  it('nulls them when there is no viewer at all', () => {
    const [out] = projectPugSlotsForViewer([SLOT], 5, null);
    expect(out?.inviteCode).toBeNull();
  });

  it('keeps them for the creator and for an operator/admin', () => {
    expect(
      projectPugSlotsForViewer([SLOT], 5, { id: 5, isAdmin: false }),
    ).toEqual([SLOT]);
    expect(
      projectPugSlotsForViewer([SLOT], 5, { id: 9, isAdmin: true }),
    ).toEqual([SLOT]);
  });
});
