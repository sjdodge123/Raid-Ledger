import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BG3_GAME_SLUG } from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../auth/types';
import {
  assertBg3HubReader,
  refuseNonBg3Hub,
  type Bg3HubRow,
} from './bg3-hub-access.helpers';

const member = { id: 7, role: 'member' } as const satisfies Pick<
  AuthenticatedUser,
  'id' | 'role'
>;
const staff = { id: 1, role: 'admin' } as const;
const hub = (over: Partial<Bg3HubRow> = {}): Bg3HubRow => ({
  id: 5,
  kind: 'game_community',
  gameSlug: BG3_GAME_SLUG,
  hidden: false,
  ...over,
});
const lookup = (row: Bg3HubRow | null) => ({
  findHub: jest.fn().mockResolvedValue(row),
});
const access = (isMember: boolean) => ({
  isMember: jest.fn().mockResolvedValue(isMember),
});

describe('refuseNonBg3Hub (D-2, D-15)', () => {
  it.each<[string, Bg3HubRow | null]>([
    ['missing', null],
    ['not a community hub', hub({ kind: 'game_server' })],
    ['another game', hub({ gameSlug: 'valheim' })],
    ['no game', hub({ gameSlug: null })],
    ['hidden', hub({ hidden: true })],
  ])('404s a %s hub for a member', (_label, row) => {
    expect(() => refuseNonBg3Hub(row, member)).toThrow(NotFoundException);
  });

  it.each(['baldurs-gate-iii', 'baldurs-gate-3'])(
    'ROK-2038: admits a BG3 hub whose game slug is %s',
    (gameSlug) => {
      expect(refuseNonBg3Hub(hub({ gameSlug }), member)).toEqual(
        hub({ gameSlug }),
      );
    },
  );

  it('lets staff see a hidden BG3 hub', () => {
    expect(refuseNonBg3Hub(hub({ hidden: true }), staff)).toEqual(
      hub({ hidden: true }),
    );
  });

  it('still 404s a non-BG3 hub for staff', () => {
    expect(() => refuseNonBg3Hub(hub({ gameSlug: 'valheim' }), staff)).toThrow(
      NotFoundException,
    );
  });
});

describe('assertBg3HubReader', () => {
  it('returns the hub for a member', async () => {
    await expect(
      assertBg3HubReader(lookup(hub()), access(true), 5, member),
    ).resolves.toEqual(hub());
  });

  it('403s a signed-in non-member on a visible hub', async () => {
    await expect(
      assertBg3HubReader(lookup(hub()), access(false), 5, member),
    ).rejects.toThrow(ForbiddenException);
  });

  it('passes staff without a membership lookup', async () => {
    const a = access(false);
    await expect(
      assertBg3HubReader(lookup(hub()), a, 5, staff),
    ).resolves.toEqual(hub());
    expect(a.isMember).not.toHaveBeenCalled();
  });

  it('404s before the membership check when the hub is missing', async () => {
    const a = access(true);
    await expect(
      assertBg3HubReader(lookup(null), a, 5, member),
    ).rejects.toThrow(NotFoundException);
    expect(a.isMember).not.toHaveBeenCalled();
  });
});
