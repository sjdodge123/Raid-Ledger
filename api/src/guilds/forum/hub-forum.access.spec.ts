/** ROK-1175 L3 — forum access: the member check and the edit/delete matrix. */
import { ForbiddenException } from '@nestjs/common';
import type { GuildAccessService } from '../guild-access.service';
import {
  FORUM_ALREADY_DELETED,
  FORUM_CANNOT_DELETE,
  FORUM_EDIT_WINDOW_CLOSED,
  FORUM_NOT_AUTHOR,
  FORUM_NOT_MEMBER,
  assertCanEdit,
  removalFor,
  resolveForumActor,
} from './hub-forum.access';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const HOUR = 3_600_000;
const fresh = {
  authorId: 3,
  createdAt: new Date(NOW.getTime() - HOUR),
  deletedAt: null,
};
const stale = { ...fresh, createdAt: new Date(NOW.getTime() - 25 * HOUR) };
const gone = { ...fresh, deletedAt: NOW };
const author = { userId: 3, canWrite: true, canModerate: false };
const member = { userId: 4, canWrite: true, canModerate: false };
const officer = { userId: 5, canWrite: true, canModerate: true };
const authorOfficer = { userId: 3, canWrite: true, canModerate: true };

function access(canView: boolean, canEdit: boolean): GuildAccessService {
  const fake: Pick<GuildAccessService, 'canView' | 'canEdit'> = {
    canView: jest.fn().mockResolvedValue(canView),
    canEdit: jest.fn().mockResolvedValue(canEdit),
  };
  return fake as GuildAccessService;
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof ForbiddenException) return err.message;
    throw err;
  }
  return 'allowed';
}

describe('ROK-1175 resolveForumActor', () => {
  const visitor = { id: 9, role: 'member' as const };

  it('403s a visitor (Q1: no reads, no writes)', async () => {
    await expect(
      resolveForumActor(access(false, false), visitor, 7),
    ).rejects.toThrow(FORUM_NOT_MEMBER);
  });

  it('a member writes but does not moderate; an officer moderates', async () => {
    await expect(
      resolveForumActor(access(true, false), visitor, 7),
    ).resolves.toEqual({
      userId: 9,
      canWrite: true,
      canModerate: false,
    });
    await expect(
      resolveForumActor(access(true, true), visitor, 7),
    ).resolves.toEqual({
      userId: 9,
      canWrite: true,
      canModerate: true,
    });
  });
});

describe('ROK-1175 assertCanEdit (Q5)', () => {
  it.each([
    ['author, fresh', author, fresh, 'allowed'],
    ['author, 25 h old', author, stale, FORUM_EDIT_WINDOW_CLOSED],
    ['author, deleted', author, gone, FORUM_ALREADY_DELETED],
    ['another member', member, fresh, FORUM_NOT_AUTHOR],
    ['an officer', officer, fresh, FORUM_NOT_AUTHOR],
  ])('%s → %s', (_l, who, row, expected) => {
    expect(refusal(() => assertCanEdit(who, row, NOW))).toBe(expected);
  });
});

describe('ROK-1175 removalFor (Q8)', () => {
  it.each([
    ['author', author, fresh, 'author'],
    ['author past the edit window', author, stale, 'author'],
    ['officer on another member', officer, fresh, 'moderator'],
    ['officer on their own', authorOfficer, fresh, 'author'],
  ] as const)('%s → deleted as %s', (_l, who, row, as) => {
    expect(removalFor(who, row, NOW)).toEqual({ by: who.userId, as, now: NOW });
  });

  it('403s another member, and a second delete', () => {
    expect(refusal(() => removalFor(member, fresh, NOW))).toBe(
      FORUM_CANNOT_DELETE,
    );
    expect(refusal(() => removalFor(officer, gone, NOW))).toBe(
      FORUM_ALREADY_DELETED,
    );
  });
});
