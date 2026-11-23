/**
 * ROK-2297 — pure rules for copying earlier chat between discussion threads
 * (an event's thread ⇄ its reschedule poll's thread). Which source rows are
 * copied, the root id a copy points at, the cap, and the header text. The
 * transaction that applies them lives in `forum-chat-copy.writes.ts`.
 */
import type { HubForumReplyKind } from '@raid-ledger/contract';

/** At most this many replies per copy — the most recent ones (OQ-D3). */
export const CHAT_COPY_CAP = 100;

/** The source-reply fields the rules read. */
export interface ChatCopySourceRow {
  id: number;
  kind: HubForumReplyKind;
  deletedAt: Date | null;
  copiedFromReplyId: number | null;
  createdAt: Date;
}

/** What to copy: `picked` ascending by time, `total` before the cap. */
export interface ChatCopyPlan<R extends ChatCopySourceRow> {
  picked: R[];
  total: number;
}

/** The ORIGINAL reply a row stands for — a copy of a copy keeps the root. */
export function copyRoot(row: ChatCopySourceRow): number {
  return row.copiedFromReplyId ?? row.id;
}

/** Oldest first; id breaks ties (the reply-page order). */
function byTime(a: ChatCopySourceRow, b: ChatCopySourceRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
}

/**
 * The rows to copy into a target thread. Only live member replies are copied
 * (signup lines, copy headers and deleted rows never). A row is skipped when
 * its root is already in the target (`takenRoots`: the target's own reply
 * ids plus the roots of its copies) — so a reschedule round trip never brings
 * the event's own chat back — or when an earlier source row had the same root.
 * The cap keeps the most recent `cap` rows, returned ascending.
 */
export function planChatCopy<R extends ChatCopySourceRow>(
  rows: readonly R[],
  takenRoots: ReadonlySet<number>,
  cap: number = CHAT_COPY_CAP,
): ChatCopyPlan<R> {
  const seen = new Set<number>();
  const eligible: R[] = [];
  for (const row of [...rows].sort(byTime)) {
    if (row.kind !== 'reply' || row.deletedAt !== null) continue;
    const root = copyRoot(row);
    if (takenRoots.has(root) || seen.has(root)) continue;
    seen.add(root);
    eligible.push(row);
  }
  return { picked: eligible.slice(-cap), total: eligible.length };
}

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Nov 20, 2026" or "Nov 20, 2026 – Nov 22, 2026" (UTC days). */
export function copyDateRange(first: Date, last: Date): string {
  const a = DAY.format(first);
  const b = DAY.format(last);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * The header row's body: `Earlier chat from <title> · N messages, <range>`,
 * plus ` (last N of M)` when the cap cut the copy. Null when nothing is
 * copied (no header is written then).
 */
export function copyHeaderBody(
  sourceTitle: string,
  plan: ChatCopyPlan<ChatCopySourceRow>,
): string | null {
  const first = plan.picked[0];
  const last = plan.picked[plan.picked.length - 1];
  if (!first || !last) return null;
  const n = plan.picked.length;
  const noun = n === 1 ? 'message' : 'messages';
  const range = copyDateRange(first.createdAt, last.createdAt);
  const cut = plan.total > n ? ` (last ${n} of ${plan.total})` : '';
  return `Earlier chat from ${sourceTitle} · ${n} ${noun}, ${range}${cut}`;
}

/** The header sorts just before the first copied row. */
export function copyHeaderTime(plan: ChatCopyPlan<ChatCopySourceRow>): Date {
  const first = plan.picked[0];
  return new Date((first?.createdAt.getTime() ?? Date.now()) - 1);
}

/**
 * Codex P1: chat never crosses a hub boundary. An event retagged to another
 * hub mid-poll leaves its poll thread in the old hub — copying would expose
 * one hub's messages in another's forum.
 */
export function sameHub(
  src: { guildId: number },
  dst: { guildId: number },
): boolean {
  return src.guildId === dst.guildId;
}
