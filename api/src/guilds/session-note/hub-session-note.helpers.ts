/**
 * ROK-1968 §5.3 — pure pieces of `HubSessionNoteService`: the lazy auto-clear
 * predicate (D6, rulings 4b/5), the checklist rewrite plan (D2) and the
 * row → contract mapping.
 */
import { BadRequestException } from '@nestjs/common';
import {
  findHubPostMarkdownViolation,
  HUB_POST_MARKDOWN_MESSAGES,
  type HubSessionNoteClearAfter,
  type HubSessionNoteItem,
  type PutHubSessionNoteItem,
} from '@raid-ledger/contract';
import type { HubSessionNoteItemSelect } from '../../drizzle/schema/hub-session-notes';
import { normalizeHubPostBody } from '../posts/hub-post-markdown.helpers';

/** The event a note is pinned to, as `events` stores it. */
export interface PinnedEventRow {
  id: number;
  title: string;
  duration: [Date, Date];
  cancelledAt: Date | null;
}

/**
 * Ruling 4b: a pinned note is gone once its event's scheduled end passes
 * (`upper(duration) <= now`, A-2). A cancelled pin never clears (ruling 5);
 * a running event has not ended, so it does not either (ruling 4c).
 */
export function isNoteExpired(pin: PinnedEventRow | null, now: Date): boolean {
  if (pin === null || pin.cancelledAt !== null) return false;
  return pin.duration[1].getTime() <= now.getTime();
}

/** Ruling 5: a cancelled pin reads as "no auto-clear". */
export function toClearAfter(
  pin: PinnedEventRow | null,
): HubSessionNoteClearAfter | null {
  if (pin === null || pin.cancelledAt !== null) return null;
  return {
    eventId: pin.id,
    title: pin.title,
    startTime: pin.duration[0].toISOString(),
    endTime: pin.duration[1].toISOString(),
  };
}

/** One stored row → the contract item (who ticked stays server-side, ruling 8). */
export function toNoteItem(row: HubSessionNoteItemSelect): HubSessionNoteItem {
  return {
    id: row.id,
    text: row.text,
    done: row.done,
    doneAt: row.doneAt === null ? null : row.doneAt.toISOString(),
  };
}

/** What an editor save does to the checklist; `position` = input order. */
export interface ItemRewritePlan {
  keep: { id: number; text: string; position: number }[];
  insert: { text: string; position: number }[];
  deleteIds: number[];
}

const UNKNOWN_ITEM = { items: ['That checklist item no longer exists'] };

/**
 * D2: an input row with an `id` keeps that stored row (and its tick); one
 * without is new; stored rows missing from the input are deleted. An id the
 * hub does not own (or one listed twice) is a 400.
 */
export function planItemRewrite(
  existingIds: readonly number[],
  input: readonly PutHubSessionNoteItem[],
): ItemRewritePlan {
  const owned = new Set(existingIds);
  const seen = new Set<number>();
  const plan: ItemRewritePlan = { keep: [], insert: [], deleteIds: [] };
  input.forEach((item, position) => {
    if (item.id === undefined) {
      plan.insert.push({ text: item.text, position });
      return;
    }
    if (!owned.has(item.id) || seen.has(item.id)) {
      throw new BadRequestException(UNKNOWN_ITEM);
    }
    seen.add(item.id);
    plan.keep.push({ id: item.id, text: item.text, position });
  });
  plan.deleteIds = existingIds.filter((id) => !seen.has(id));
  return plan;
}

const EMPTY_NOTE = { body: ['Add a note or at least one checklist item'] };

/**
 * D12 body pipeline: normalise (hub-post subset), re-run the markdown subset
 * on the result (normalising can create forbidden syntax — see
 * `hub-posts.service.helpers.ts::finalBody`), and re-check "body or items"
 * because normalising can blank a body Zod accepted.
 */
export function noteBody(raw: string, itemCount: number): string {
  const body = normalizeHubPostBody(raw);
  if (body.trim() === '') {
    if (itemCount === 0) throw new BadRequestException(EMPTY_NOTE);
    return '';
  }
  const violation = findHubPostMarkdownViolation(body);
  if (violation) {
    throw new BadRequestException({
      body: [HUB_POST_MARKDOWN_MESSAGES[violation]],
    });
  }
  return body;
}
