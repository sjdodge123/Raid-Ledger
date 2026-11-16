/**
 * ROK-2208 OQ-4 (review B1 item 4) — when an unsynced Discord post earns the
 * one "add one hub tag" bot reply. Pure decision; the send/idempotency path
 * is covered by `hub-forum-discord-notice.integration.spec.ts`.
 */
import { needsTagNotice, TAG_NOTICE } from './hub-forum-discord-notice';
import type { RouteBinding } from './hub-forum-discord-route';

const EPOCH = 1420070400000n;
const snowAt = (ms: number): string => ((BigInt(ms) - EPOCH) << 22n).toString();
const BOUND = new Date('2026-11-16T00:00:00Z');
const AFTER = snowAt(BOUND.getTime() + 60_000);

const bound = (guildId: number, tagId: string | null): RouteBinding => ({
  guildId,
  tagId,
  boundAt: BOUND,
});
const shared = [bound(1, 't1'), bound(2, 't2')];
const thread = (appliedTags: string[], id = AFTER) => ({ id, appliedTags });

describe('needsTagNotice (OQ-4)', () => {
  it('a shared forum post with no tag needs the notice', () => {
    expect(needsTagNotice(shared, thread([]))).toBe(true);
  });

  it('a shared forum post with only non-hub tags needs the notice', () => {
    expect(needsTagNotice(shared, thread(['other']))).toBe(true);
  });

  it('a shared forum post carrying two hub tags needs the notice', () => {
    expect(needsTagNotice(shared, thread(['t1', 't2']))).toBe(true);
  });

  it('a shared forum post with exactly one hub tag syncs, so no notice', () => {
    expect(needsTagNotice(shared, thread(['t2', 'other']))).toBe(false);
  });

  it('a single-binding forum never gets the notice, tagged or not', () => {
    expect(needsTagNotice([bound(1, null)], thread([]))).toBe(false);
    expect(needsTagNotice([bound(1, 't1')], thread(['x', 'y']))).toBe(false);
  });

  it('a post older than every binding could never sync (R8), so no notice', () => {
    const old = snowAt(BOUND.getTime() - 86_400_000);
    expect(needsTagNotice(shared, thread([], old))).toBe(false);
  });

  it('uses the ruled copy', () => {
    expect(TAG_NOTICE).toBe(
      'Add one hub tag to sync this post to Raid Ledger.',
    );
  });
});
