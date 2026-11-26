/**
 * ROK-2352 review MINOR-7 / r2 MAJOR-A — a NEW HTTP hand in a plugin group
 * must carry `handDetail` (spec §3.3 / AC3); a re-post into a group the user
 * already holds keeps the stored detail. The whole-game group, a folded game
 * and Discord callers stay detail-free.
 */
import { BadRequestException } from '@nestjs/common';
import type * as schema from '../drizzle/schema';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  assertHandDetailIfNew,
  resolvePostGroup,
} from './lfg-group-post.helpers';
import type { LfgGroupingRegistry } from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { findActiveIntent } from './lfg-write.helpers';

jest.mock('./lfg-write.helpers', () => ({ findActiveIntent: jest.fn() }));
const findActive = findActiveIntent as jest.MockedFunction<
  typeof findActiveIntent
>;
const TX = {} as LfgDb;

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

function keyedNoDetail() {
  return resolvePostGroup(
    registry(true),
    GAME,
    { ...WEEK, groupKey: 'dungeon:1' },
    STRICT,
  );
}

describe('resolvePostGroup — required hand detail (§3.3)', () => {
  it('flags a keyed hand with no handDetail when the route requires one', async () => {
    const post = await keyedNoDetail();
    expect(post.detailRequired).toBe(true);
  });

  it('accepts the keyed hand once handDetail is present', async () => {
    const post = await resolvePostGroup(
      registry(true),
      GAME,
      { ...WEEK, groupKey: 'dungeon:1', handDetail: { roles: ['tank'] } },
      STRICT,
    );
    expect(post.opts.groupKey).toBe('dungeon:1');
    expect(post.detailRequired).toBe(false);
  });

  it('never requires a detail for the whole-game group', async () => {
    const post = await resolvePostGroup(registry(true), GAME, WEEK, STRICT);
    expect(post.opts.groupKey).toBe('');
    expect(post.detailRequired).toBe(false);
  });

  it('never requires a detail on a folded game (plugin off → "")', async () => {
    const post = await resolvePostGroup(
      registry(false),
      GAME,
      { ...WEEK, groupKey: 'dungeon:1' },
      STRICT,
    );
    expect(post.opts.groupKey).toBe('');
    expect(post.detailRequired).toBe(false);
  });

  it('lets a Discord caller (no write options) raise a roleless keyed hand', async () => {
    const post = await resolvePostGroup(registry(true), GAME, {
      ...WEEK,
      groupKey: 'dungeon:1',
    });
    expect(post.opts.groupKey).toBe('dungeon:1');
    expect(post.detailRequired).toBe(false);
  });
});

describe('assertHandDetailIfNew — only a new keyed hand needs a detail (r2 MAJOR-A)', () => {
  beforeEach(() => findActive.mockReset());

  it('400s when the user holds no live hand in the group', async () => {
    findActive.mockResolvedValue(null);
    const err: unknown = await assertHandDetailIfNew(
      TX,
      7,
      GAME.id,
      await keyedNoDetail(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      handDetail: ['Required when raising a hand in this group'],
    });
    expect(findActive).toHaveBeenCalledWith(TX, 7, GAME.id, 'dungeon:1');
  });

  it('lets an urgency-only re-post into a held group through', async () => {
    findActive.mockResolvedValue({ id: 1 } as Awaited<
      ReturnType<typeof findActiveIntent>
    >);
    await expect(
      assertHandDetailIfNew(TX, 7, GAME.id, await keyedNoDetail()),
    ).resolves.toBeUndefined();
  });

  it('skips the lookup when no detail is required', async () => {
    const post = await resolvePostGroup(registry(true), GAME, WEEK, STRICT);
    await assertHandDetailIfNew(TX, 7, GAME.id, post);
    expect(findActive).not.toHaveBeenCalled();
  });
});
