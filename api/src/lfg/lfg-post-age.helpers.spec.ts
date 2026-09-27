/**
 * ROK-1691 — "This week" means 7 days, and a board post retires 7 days after
 * it opened no matter how many +1s it collected.
 *
 * The post-age cap is the new clock. A +1 refreshes every hand on the group
 * (`lfg-urgency.helpers.ts`), so an active group never aged out under the hand
 * clock alone; the operator's board kept week-old posts up by design. The cap
 * is read off `lfg_group_messages.posted_at`, which a re-post resets because a
 * re-post is a NEW row (the open-row unique index is partial on `state`).
 *
 * These cases pin the arithmetic and the selection the sweep embeds. The
 * end-to-end walk (sweep → expired render → archived thread) is
 * `lfg-board-post-age.integration.spec.ts`.
 */
import {
  LFG_EXPIRY_DAYS,
  LFG_POST_MAX_AGE_DAYS,
  computePostAgeCutoff,
} from './lfg.constants';
import { agedBoardPostGameIds } from './lfg-post-age.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-26T12:00:00.000Z');

describe('ROK-1691 — the week horizon and the board post-age cap', () => {
  // Mutation: set LFG_EXPIRY_DAYS back to 14 and this fails on the value.
  it('makes "This week" a 7-day hand', () => {
    expect(LFG_EXPIRY_DAYS).toBe(7);
  });

  it('caps a board post at 7 days from when it opened', () => {
    expect(LFG_POST_MAX_AGE_DAYS).toBe(7);
  });

  it('puts the cutoff exactly LFG_POST_MAX_AGE_DAYS before now', () => {
    expect(computePostAgeCutoff(NOW).toISOString()).toBe(
      new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    );
  });
});

describe('agedBoardPostGameIds — which groups the sweep retires by age', () => {
  const rendered = (): { sql: string; params: unknown[] } =>
    agedBoardPostGameIds(NOW).toSQL();

  it('selects the game of each post from lfg_group_messages', () => {
    expect(rendered().sql).toMatch(
      /^select "game_id" from "lfg_group_messages"/,
    );
  });

  // Only a LIVE post can retire: a closed row's thread is already archived,
  // and re-closing it would re-edit a thread nobody is looking at.
  it('only considers OPEN forum posts', () => {
    const { sql, params } = rendered();
    expect(sql).toContain('"lfg_group_messages"."state" = $1');
    expect(sql).toContain('"lfg_group_messages"."post_kind" = $2');
    expect(params.slice(0, 2)).toEqual(['open', 'forum']);
  });

  // `<=` on the cutoff: a post exactly 7 days old is due. The param is the
  // cutoff itself, so a cap measured from the wrong constant (14) fails here.
  // Both sides compare as timestamptz: `posted_at` is a naive column written
  // by the DB's `now()` in its session zone, so a bare `posted_at <= $3`
  // against a UTC instant is off by that zone's offset on a non-UTC DB.
  it('selects posts that opened on or before the 7-day cutoff, as instants', () => {
    const { sql, params } = rendered();
    expect(sql).toContain(
      '"lfg_group_messages"."posted_at"::timestamptz <= $3::timestamptz',
    );
    expect(params[2]).toBe(new Date(NOW.getTime() - 7 * DAY_MS).toISOString());
  });
});
