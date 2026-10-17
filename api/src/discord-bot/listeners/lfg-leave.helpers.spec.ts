/**
 * ROK-1660 — the shared leave copy + the one write path, and the `Leave · {game}`
 * rename on the list buttons (same custom id as before).
 */
import { NotFoundException } from '@nestjs/common';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import {
  buildListReply,
  parseWithdrawCustomId,
} from '../commands/lfg.command.helpers';
import { at } from '../../common/testing/narrow';
import {
  buildLeftReply,
  buildNotInGroupReply,
  leaveCustomId,
  leaveOneGroup,
  parseLeaveCustomId,
  withdrawIfPresent,
} from './lfg-leave.helpers';

function group(over: Partial<LfgGroupSummaryDto> = {}): LfgGroupSummaryDto {
  return {
    gameId: 42,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    gameCoverUrl: null,
    activeCount: 2,
    nowCount: 0,
    soonestNowExpiresAt: null,
    playingNow: null,
    state: 'lfm',
    viabilityThreshold: 4,
    isViable: false,
    hasOwnIntent: true,
    soonestExpiresAt: '2026-09-17T10:00:00.000Z',
    ...over,
  };
}

function writer(
  withdraw: jest.Mock = jest.fn().mockResolvedValue(undefined),
  groups: LfgGroupSummaryDto[] = [],
) {
  return { withdraw, listGroups: jest.fn().mockResolvedValue(groups) };
}

describe('leave copy (ROK-1660 exact-copy sheet)', () => {
  it('names the game and the remaining count', () => {
    expect(buildLeftReply('Valheim', 3)).toBe(
      "You're out — **Valheim**. 3 still looking.",
    );
  });

  it('drops the count when nobody is left', () => {
    expect(buildLeftReply('Valheim', 0)).toBe("You're out — **Valheim**.");
    expect(buildLeftReply('Valheim')).toBe("You're out — **Valheim**.");
  });

  it('words the no-hand case', () => {
    expect(buildNotInGroupReply('Valheim')).toBe(
      "You're not in the **Valheim** group.",
    );
  });
});

describe('leave custom id', () => {
  it('round-trips lfg:leave:<gameId> and is never read as a withdraw', () => {
    expect(leaveCustomId(42)).toBe('lfg:leave:42');
    expect(parseLeaveCustomId(leaveCustomId(42))).toBe(42);
    expect(parseWithdrawCustomId(leaveCustomId(42))).toBeNull();
    expect(parseLeaveCustomId('lfg:withdraw:42')).toBeNull();
    expect(parseLeaveCustomId('lfg:leave:4x')).toBeNull();
  });
});

describe('withdrawIfPresent / leaveOneGroup', () => {
  it('withdraws and reports how many are still looking', async () => {
    const lfg = writer(undefined, [group({ gameId: 42, activeCount: 3 })]);
    await expect(leaveOneGroup(lfg, 7, 42)).resolves.toEqual({
      left: true,
      stillLooking: 3,
    });
    expect(lfg.withdraw).toHaveBeenCalledWith(7, 42);
  });

  it('reports 0 when the group is gone after the leave', async () => {
    const lfg = writer(undefined, [group({ gameId: 9 })]);
    await expect(leaveOneGroup(lfg, 7, 42)).resolves.toEqual({
      left: true,
      stillLooking: 0,
    });
  });

  it('maps NotFound to "not in the group", without reading the list', async () => {
    const lfg = writer(jest.fn().mockRejectedValue(new NotFoundException()));
    await expect(leaveOneGroup(lfg, 7, 42)).resolves.toEqual({
      left: false,
      stillLooking: 0,
    });
    expect(lfg.listGroups).not.toHaveBeenCalled();
  });

  it('rethrows every other failure', async () => {
    const boom = new Error('db down');
    const lfg = writer(jest.fn().mockRejectedValue(boom));
    await expect(withdrawIfPresent(lfg, 7, 42)).rejects.toBe(boom);
  });
});

describe('list buttons — `Leave · {game}` (ROK-1660 rename)', () => {
  const ctx = {
    communityName: 'Gamer Night',
    clientUrl: 'https://raid.example',
    timezone: 'UTC',
  };

  it('labels the button Leave and keeps the lfg:withdraw: id', () => {
    const { components } = buildListReply([group()], ctx);
    const button = at(at(components, 0).toJSON().components, 0) as {
      label?: string;
      custom_id?: string;
    };
    expect(button.label).toBe('Leave · Deep Rock Galactic');
    expect(button.custom_id).toBe('lfg:withdraw:42');
  });
});
