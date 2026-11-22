/**
 * ROK-2297 D1 — the pure copy rules: what is skipped, the root a copy keeps,
 * the cap and the header text.
 */
import {
  CHAT_COPY_CAP,
  copyDateRange,
  copyHeaderBody,
  copyHeaderTime,
  copyRoot,
  planChatCopy,
  type ChatCopySourceRow,
} from './forum-chat-copy.rules';

const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
const MIN = 60_000;

function row(
  id: number,
  over: Partial<ChatCopySourceRow> = {},
): ChatCopySourceRow {
  return {
    id,
    kind: 'reply',
    deletedAt: null,
    copiedFromReplyId: null,
    createdAt: new Date(T0 + id * MIN),
    ...over,
  };
}

const ids = (rows: readonly ChatCopySourceRow[]) => rows.map((r) => r.id);

describe('planChatCopy', () => {
  it('skips signup lines, copy headers and deleted replies', () => {
    const plan = planChatCopy(
      [
        row(1),
        row(2, { kind: 'signup_line' }),
        row(3, { kind: 'copy_header' }),
        row(4, { deletedAt: new Date(T0) }),
        row(5),
      ],
      new Set(),
    );
    expect(ids(plan.picked)).toEqual([1, 5]);
    expect(plan.total).toBe(2);
  });

  it('skips a row whose root is already in the target', () => {
    const plan = planChatCopy(
      [row(1), row(2, { copiedFromReplyId: 9 }), row(3)],
      new Set([9, 3]),
    );
    expect(ids(plan.picked)).toEqual([1]);
  });

  it('keeps one row per root', () => {
    const plan = planChatCopy(
      [row(1, { copiedFromReplyId: 7 }), row(2, { copiedFromReplyId: 7 })],
      new Set(),
    );
    expect(ids(plan.picked)).toEqual([1]);
  });

  it('sorts ascending by time, id breaking ties', () => {
    const same = new Date(T0);
    const plan = planChatCopy(
      [row(3), row(2, { createdAt: same }), row(1, { createdAt: same })],
      new Set(),
    );
    expect(ids(plan.picked)).toEqual([1, 2, 3]);
  });

  it('caps at the most recent 100, ascending', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(150 - i));
    const plan = planChatCopy(rows, new Set());
    expect(CHAT_COPY_CAP).toBe(100);
    expect(plan.total).toBe(150);
    expect(plan.picked).toHaveLength(100);
    expect(plan.picked[0]?.id).toBe(51);
    expect(plan.picked[99]?.id).toBe(150);
  });
});

describe('copyRoot', () => {
  it('a copy of a copy points at the original reply', () => {
    expect(copyRoot(row(5, { copiedFromReplyId: 2 }))).toBe(2);
    expect(copyRoot(row(5))).toBe(5);
  });
});

describe('copyHeaderBody', () => {
  it('names the source, count and date range', () => {
    const plan = planChatCopy(
      [row(1), row(2, { createdAt: new Date(T0 + 2 * 86_400_000) })],
      new Set(),
    );
    expect(copyHeaderBody('Raid night', plan)).toBe(
      'Earlier chat from Raid night · 2 messages, Nov 20, 2026 – Nov 22, 2026',
    );
  });

  it('says "last N of M" when capped and "message" for one', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(i + 1));
    expect(copyHeaderBody('Poll', planChatCopy(rows, new Set()))).toBe(
      'Earlier chat from Poll · 100 messages, Nov 20, 2026 (last 100 of 150)',
    );
    expect(copyHeaderBody('Poll', planChatCopy([row(1)], new Set()))).toBe(
      'Earlier chat from Poll · 1 message, Nov 20, 2026',
    );
  });

  it('is null when nothing is copied', () => {
    expect(copyHeaderBody('Poll', { picked: [], total: 0 })).toBeNull();
  });
});

describe('copyHeaderTime / copyDateRange', () => {
  it('the header sorts 1 ms before the first copy', () => {
    const plan = planChatCopy([row(4), row(2)], new Set());
    expect(copyHeaderTime(plan).getTime()).toBe(T0 + 2 * MIN - 1);
  });

  it('one day prints once', () => {
    expect(copyDateRange(new Date(T0), new Date(T0 + MIN))).toBe(
      'Nov 20, 2026',
    );
  });
});
