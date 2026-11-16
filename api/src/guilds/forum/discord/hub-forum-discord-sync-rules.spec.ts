/**
 * ROK-2208 L6 — the pure reconcile + retry rules (§5.6): which messages a
 * reconnect replays, which outbox rows the sweep picks, and what it does.
 */
import { unsentId } from './hub-forum-discord-links.queries';
import {
  RETRY_GRACE_MS,
  RETRY_MAX_ATTEMPTS,
  isRetryDue,
  replayAfter,
  retryDelayMs,
  retryOp,
  retryStalled,
} from './hub-forum-discord-sync-rules';

const MIN = 60_000;
const now = new Date('2026-11-16T12:00:00Z');
const ago = (ms: number): Date => new Date(now.getTime() - ms);

describe('replayAfter (§5.6: fetch messages after the newest linked snowflake)', () => {
  it('picks the numerically newest linked id, not the lexically last', () => {
    const ids = [
      '99999999999999999',
      '100000000000000001',
      '100000000000000000',
    ];
    expect(replayAfter('90000000000000000', ids)).toBe('100000000000000001');
  });

  it('ignores unsent placeholder ids', () => {
    const ids = ['100000000000000000', unsentId('reply', 7)];
    expect(replayAfter('90000000000000000', ids)).toBe('100000000000000000');
  });

  it('an unknown post replays from just before its starter (starter id = thread id)', () => {
    expect(replayAfter('100000000000000000', [])).toBe('99999999999999999');
    expect(replayAfter('100000000000000000', [unsentId('thread', 3)])).toBe(
      '99999999999999999',
    );
  });
});

describe('retryDelayMs / isRetryDue (backoff by attempts)', () => {
  it('waits a grace period before touching a never-attempted pending row', () => {
    expect(retryDelayMs(0)).toBe(RETRY_GRACE_MS);
    const fresh = { attempts: 0, syncedAt: null, createdAt: ago(30_000) };
    expect(isRetryDue(fresh, now)).toBe(false);
    const stale = {
      attempts: 0,
      syncedAt: null,
      createdAt: ago(RETRY_GRACE_MS),
    };
    expect(isRetryDue(stale, now)).toBe(true);
  });

  it('backs off longer with every failed attempt', () => {
    expect(retryDelayMs(1)).toBe(5 * MIN);
    expect(retryDelayMs(2)).toBe(15 * MIN);
    expect(retryDelayMs(4)).toBe(75 * MIN);
    const twice = { attempts: 2, syncedAt: null, createdAt: ago(10 * MIN) };
    expect(isRetryDue(twice, now)).toBe(false);
    expect(isRetryDue({ ...twice, createdAt: ago(15 * MIN) }, now)).toBe(true);
  });

  it('measures from the last success when the row was synced before', () => {
    const edit = {
      attempts: 1,
      syncedAt: ago(2 * MIN),
      createdAt: ago(600 * MIN),
    };
    expect(isRetryDue(edit, now)).toBe(false);
  });

  it('gives up at the attempts cap', () => {
    const dead = {
      attempts: RETRY_MAX_ATTEMPTS,
      syncedAt: null,
      createdAt: ago(9999 * MIN),
    };
    expect(RETRY_MAX_ATTEMPTS).toBe(5);
    expect(isRetryDue(dead, now)).toBe(false);
    expect(isRetryDue({ ...dead, attempts: 4 }, now)).toBe(true);
  });
});

describe('retryOp (what the sweep re-drives)', () => {
  const sent = {
    kind: 'reply',
    discordMessageId: '100000000000000000',
    discordDeletedAt: null,
  };

  it('an unsent placeholder is re-created, never edited as if it were a snowflake', () => {
    expect(
      retryOp(
        { ...sent, kind: 'thread', discordMessageId: unsentId('thread', 4) },
        false,
      ),
    ).toBe('thread.created');
    expect(
      retryOp({ ...sent, discordMessageId: unsentId('reply', 9) }, false),
    ).toBe('reply.created');
  });

  it('a sent row is re-edited; a sent row whose RL row is gone is re-deleted', () => {
    expect(retryOp(sent, false)).toBe('reply.updated');
    expect(retryOp({ ...sent, kind: 'thread' }, true)).toBe('thread.deleted');
  });

  it('nothing to do once the Discord side is gone', () => {
    expect(retryOp({ ...sent, discordDeletedAt: now }, false)).toBeNull();
  });
});

describe('retryStalled (review MAJOR-3: a row retry() can never send leaves the queue)', () => {
  const before = { syncState: 'pending', attempts: 0, discordDeletedAt: null };
  const reply = {
    kind: 'reply' as const,
    discordMessageId: unsentId('reply', 9),
  };
  const livePost = {
    discordMessageId: unsentId('thread', 3),
    attempts: 1,
    discordDeletedAt: null,
  };

  it('is stalled when the row came back exactly as it went in', () => {
    expect(retryStalled({ ...before, ...reply }, { ...before }, null)).toBe(
      true,
    );
  });

  it('is not stalled once the attempt changed the row (sent, failed or deleted)', () => {
    const row = { ...before, ...reply };
    expect(retryStalled(row, { ...before, syncState: 'synced' }, null)).toBe(
      false,
    );
    expect(retryStalled(row, { ...before, attempts: 1 }, null)).toBe(false);
    expect(retryStalled(row, { ...before, discordDeletedAt: now }, null)).toBe(
      false,
    );
    expect(retryStalled(row, null, null)).toBe(false);
  });

  it('a placeholder reply waiting on a still-retryable post is not stalled', () => {
    expect(retryStalled({ ...before, ...reply }, { ...before }, livePost)).toBe(
      false,
    );
  });

  it('a reply under a dead or deleted post IS stalled', () => {
    const row = { ...before, ...reply };
    const dead = { ...livePost, attempts: RETRY_MAX_ATTEMPTS };
    const gone = { ...livePost, discordDeletedAt: now };
    expect(retryStalled(row, { ...before }, dead)).toBe(true);
    expect(retryStalled(row, { ...before }, gone)).toBe(true);
  });
});
