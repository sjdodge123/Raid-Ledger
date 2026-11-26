/**
 * ROK-2352 review MINOR-7 — `resolvePostGroup` refuses an HTTP hand in a
 * plugin group that carries no `handDetail` (spec §3.3 / AC3), while the
 * whole-game group, a folded game and Discord callers stay detail-free.
 */
import { BadRequestException } from '@nestjs/common';
import type * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { resolvePostGroup } from './lfg-group-post.helpers';
import type { LfgGroupingRegistry } from './lfg-grouping.helpers';

const GAME = {
  id: 3,
  slug: 'world-of-warcraft-classic',
} as typeof schema.games.$inferSelect;
const WEEK = { urgency: 'week' as const };

function registry(active: boolean): LfgGroupingRegistry {
  const adapter = {
    describeGroup: jest.fn(() =>
      Promise.resolve({
        key: 'dungeon:1',
        label: 'D',
        kind: 'dungeon',
        size: 5,
      }),
    ),
  } as unknown as LfgGroupingAdapter;
  return {
    getAdapter: jest.fn().mockReturnValue(active ? adapter : undefined),
  };
}

const STRICT = { requireHandDetail: true };

describe('resolvePostGroup — required hand detail (§3.3)', () => {
  it('400s a keyed hand with no handDetail when the route requires one', async () => {
    const err: unknown = await resolvePostGroup(
      registry(true),
      GAME,
      { ...WEEK, groupKey: 'dungeon:1' },
      STRICT,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      handDetail: ['Required when raising a hand in this group'],
    });
  });

  it('accepts the keyed hand once handDetail is present', async () => {
    const post = await resolvePostGroup(
      registry(true),
      GAME,
      { ...WEEK, groupKey: 'dungeon:1', handDetail: { roles: ['tank'] } },
      STRICT,
    );
    expect(post.opts.groupKey).toBe('dungeon:1');
  });

  it('never requires a detail for the whole-game group', async () => {
    const post = await resolvePostGroup(registry(true), GAME, WEEK, STRICT);
    expect(post.opts.groupKey).toBe('');
  });

  it('never requires a detail on a folded game (plugin off → "")', async () => {
    const post = await resolvePostGroup(
      registry(false),
      GAME,
      { ...WEEK, groupKey: 'dungeon:1' },
      STRICT,
    );
    expect(post.opts.groupKey).toBe('');
  });

  it('lets a Discord caller (no write options) raise a roleless keyed hand', async () => {
    const post = await resolvePostGroup(registry(true), GAME, {
      ...WEEK,
      groupKey: 'dungeon:1',
    });
    expect(post.opts.groupKey).toBe('dungeon:1');
  });
});
