/**
 * ROK-1787 (Codex P2): a series update applies the DTO to every targeted
 * occurrence, so the guild/game check must cover each one, not just the anchor.
 */
import { BadRequestException } from '@nestjs/common';
import {
  EventGuildTagService,
  GUILD_GAME_MISMATCH,
} from './event-guild-tag.service';

const actor = { id: 7, role: 'member' as const };
const when = new Date('2026-11-01T19:00:00.000Z');

type Row = { id: number; gameId: number | null; guildId: number | null };

function row(r: Row, creatorId = actor.id) {
  return { ...r, creatorId, recurrenceGroupId: 'g1', duration: [when, when] };
}

function setup(anchor: Row, others: Row[], creatorId = actor.id) {
  const anchorRow = row(anchor, creatorId);
  const targets = [anchorRow, ...others.map((o) => row(o, creatorId))];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: jest.fn().mockResolvedValue([anchorRow]),
    orderBy: jest.fn().mockResolvedValue(targets),
  };
  const db = { select: jest.fn(() => chain) };
  const t = {
    pluginSlug: 'blizzard',
    assertCanTag: jest.fn().mockResolvedValue(undefined),
  };
  const registry = { getAdapter: () => t, isActive: () => true };
  const svc = new EventGuildTagService(registry as never, db as never);
  return { svc, t };
}

describe('EventGuildTagService.assertSeriesUpdate', () => {
  it('refuses a game change through an untagged anchor that strands a tagged occurrence', async () => {
    const { svc } = setup({ id: 1, gameId: 3, guildId: null }, [
      { id: 2, gameId: 3, guildId: 9 },
    ]);
    await expect(
      svc.assertSeriesUpdate(actor, 1, 'all', { gameId: 4 }),
    ).rejects.toThrow(new BadRequestException(GUILD_GAME_MISMATCH));
  });

  it('checks a series-wide tag against every distinct occurrence game', async () => {
    const { svc, t } = setup({ id: 1, gameId: 3, guildId: null }, [
      { id: 2, gameId: 5, guildId: null },
      { id: 3, gameId: 3, guildId: null },
    ]);
    await svc.assertSeriesUpdate(actor, 1, 'this_and_following', {
      guildId: 9,
    });
    expect(t.assertCanTag.mock.calls).toEqual([
      [actor, 9, 3],
      [actor, 9, 5],
    ]);
  });

  it('allows a game change when no occurrence is tagged', async () => {
    const { svc } = setup({ id: 1, gameId: 3, guildId: null }, [
      { id: 2, gameId: 3, guildId: null },
    ]);
    await expect(
      svc.assertSeriesUpdate(actor, 1, 'all', { gameId: 4 }),
    ).resolves.toBeUndefined();
  });

  it('leaves a non-owner to the series owner 403 (no guild answer leaks)', async () => {
    const { svc, t } = setup(
      { id: 1, gameId: 3, guildId: null },
      [{ id: 2, gameId: 3, guildId: 9 }],
      99,
    );
    await expect(
      svc.assertSeriesUpdate(actor, 1, 'all', { guildId: 12, gameId: 4 }),
    ).resolves.toBeUndefined();
    expect(t.assertCanTag).not.toHaveBeenCalled();
  });
});
