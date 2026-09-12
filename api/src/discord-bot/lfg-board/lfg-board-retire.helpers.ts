/**
 * ROK-1523 — classifying what Discord said "no" with, during the retire pass.
 *
 * The distinction is load-bearing, not tidiness. The retire pass closes the
 * `lfg_group_messages` row, and a closed row is invisible to
 * `LfmEmbedService.reconcileOpenRows` forever. So:
 *
 *  - a PERMANENT refusal (the channel is gone, the grant was revoked) means
 *    nobody will ever edit that post again — closing the row anyway is the
 *    only thing that stops it holding its game hostage to
 *    `uq_lfg_group_messages_game_open`, which is AC9's wedge class;
 *  - a TRANSIENT failure (the bot is disconnected, no guild yet, a 429, a 5xx)
 *    means the post is still there and still editable in a minute. Closing on
 *    one of those loses the farewell, the archive AND the tracking row in a
 *    single step, for an outage that resolves itself. Leaving the row OPEN
 *    hands it to the reconnect reconciliation, which is exactly the mechanism
 *    that exists for "the bot was down when it mattered".
 *
 * Default is TRANSIENT: an unrecognised error is much more likely to be an
 * outage than a revocation, and the transient branch is the recoverable one.
 *
 * **A numeric `code` is AUTHORITATIVE and ends the question.** Discord's REST
 * errors carry one, and round 3 of this story was rejected because the message
 * text was consulted anyway: `LfgBoardService.fetchThread` used to rephrase
 * every fetch rejection as `Unknown Message: ...`, so a 429 matched the
 * substring list and classified PERMANENT — the row closed, the post stayed
 * live and untracked, and a re-enable posted a second card for the game. The
 * substring list survives only for the errors WE construct, which carry no
 * code at all.
 */

import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import {
  closeLfmMessage,
  findOpenLfmMessage,
  loadLfmGame,
  type LfmMessageRow,
} from '../lfm/lfm-embed.db-helpers';
import { currentView } from '../lfm/lfm-embed.views';

/**
 * The farewell render: whatever the group actually is, ended and annotated.
 *
 * SHARED by the two writers that can retire a post — {@link
 * LfgBoardRetireService} on the disable itself, and
 * `LfmEmbedService.reconcileRow` when the disable's edit failed transiently and
 * the reconnect has to finish the job. One definition so the retry cannot
 * disagree with the original: `closed` is terminal (so `editThread` archives
 * and `persist` closes the row) and `boardRetired` is what puts
 * `LFG_BOARD_RETIRED_NOTE` on the card.
 *
 * @param view - The group as its caller read it (`currentView` / the reconcile).
 * @returns The same group, rendered as a board-off farewell.
 */
export function boardOffView(view: LfmGroupView): LfmGroupView {
  return { ...view, state: 'closed', boardRetired: true };
}

/** Discord codes meaning the thread/message itself no longer exists. */
const GONE_CODES = new Set([
  10003, // Unknown Channel — the forum or thread is gone
  10008, // Unknown Message — the starter message is gone
]);

/** Discord codes proving the post is unreachable: gone, or walled off. */
const PERMANENT_CODES = new Set([
  ...GONE_CODES,
  50001, // Missing Access
  50013, // Missing Permissions
]);

/** The gone pair, as the message text an error we built may carry. */
const GONE_MESSAGES = ['Unknown Channel', 'Unknown Message'];

/** The same four, as the message text a non-`DiscordAPIError` may carry. */
const PERMANENT_MESSAGES = [
  ...GONE_MESSAGES,
  'Missing Access',
  'Missing Permissions',
];

/** Code-first classification. A numeric code is the whole answer (see above). */
function matches(err: Error, codes: Set<number>, messages: string[]): boolean {
  const { code } = err as Error & { code?: unknown };
  if (typeof code === 'number') return codes.has(code);
  return messages.some((m) => err.message.includes(m));
}

/**
 * Does this rejection prove the thread is GONE, rather than merely unreadable?
 *
 * Narrower than {@link isPermanentRefusal} on purpose: only "gone" justifies
 * translating an error into the vocabulary `isUnknownMessageError` matches,
 * because that predicate makes `LfmEmbedService.editRow` DELETE the row and
 * post a replacement. A revoked grant or a rate limit read as "gone" therefore
 * double-posts; a 50001 belongs on the permanent list but not on this one.
 *
 * @param err - Whatever a thread fetch rejected with.
 * @returns True when the thread genuinely no longer exists.
 */
export function isThreadGoneError(err: unknown): boolean {
  return err instanceof Error && matches(err, GONE_CODES, GONE_MESSAGES);
}

/**
 * Does this rejection prove the post is unreachable for good?
 *
 * @param err - Whatever `editThread` rejected with.
 * @returns True for a permanent refusal; false (the safe default) otherwise.
 */
export function isPermanentRefusal(err: unknown): boolean {
  return (
    err instanceof Error && matches(err, PERMANENT_CODES, PERMANENT_MESSAGES)
  );
}

/** Best-effort message for a caught `unknown`, never a bare cast. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What one retire needs from its caller. A plain bag, not a service: the two
 * writers that retire a post live in different modules, and injecting either
 * into the other closes a cycle (`LfmEmbedModule` imports `LfgBoardModule`).
 */
export interface RetireRowDeps {
  /** The LFG datasource. */
  db: LfgDb;
  /** `LfgBoardService.editThread`, bound. */
  editThread: (
    row: LfmMessageRow,
    view: LfmGroupView,
    context: EmbedContext,
  ) => Promise<void>;
  /** Where a contained failure is reported. */
  warn: (message: string) => void;
}

/**
 * Retire ONE live forum post: farewell edit, then close — unless the edit
 * failed TRANSIENTLY.
 *
 * THE one implementation of retire semantics, called by both writers that can
 * retire a post: {@link LfgBoardRetireService} on the disable itself, and
 * `LfmEmbedService.reconcileRow` when that edit failed transiently and the
 * reconnect has to finish the job. Sharing the function rather than the
 * farewell view is what stops the retry disagreeing with the original — the
 * reconcile used to route this through `LfmEmbedService.editRow`, whose
 * close-anyway rule keys off the rendered state, and `boardOffView` forces
 * `closed`, so a 429 on the retry closed the row while the post stayed live.
 *
 * A permanently refused edit does NOT abandon the row: closing anyway is the
 * same rule `editRow` applies to a refused terminal render, because an
 * unclosable `open` row wedges the game against
 * `uq_lfg_group_messages_game_open`. A transient failure is the opposite case
 * and is left open on purpose.
 *
 * The row is RE-READ first. The caller's worklist is a snapshot taken before
 * this joined the game's chain, and a `GROUP_CHANGED` queued ahead of it can
 * terminalise the same row meanwhile — a conversion, an expiry. Acting on the
 * stale snapshot then unarchives that final card and overwrites it with "the
 * board was switched off, still live on the site" over a group that actually
 * got SCHEDULED. Whoever got there first wins.
 *
 * @param deps - Datasource, the bound thread editor, and a warn sink.
 * @param row - The tracked forum row to retire.
 * @param context - Community branding / URL / timezone for the card.
 * @returns 1 when a post was retired and its row closed, 0 when the row was
 *   left open for the reconcile, was already gone, or its game has been
 *   deleted (E13 — the row is still closed, but no post was retired).
 */
export async function retireOpenRow(
  deps: RetireRowDeps,
  row: LfmMessageRow,
  context: EmbedContext,
): Promise<number> {
  const live = await findOpenLfmMessage(deps.db, row.gameId);
  if (!live || live.id !== row.id) return 0;
  const game = await loadLfmGame(deps.db, live.gameId);
  const view = game ? boardOffView(await currentView(deps.db, game)) : null;
  if (view && !(await edited(deps, live, view, context))) return 0;
  await closeLfmMessage(
    deps.db,
    live.id,
    'closed',
    view?.memberCount ?? live.lastMemberCount,
  );
  return view ? 1 : 0;
}

/**
 * The farewell edit.
 *
 * @param deps - The caller's collaborators.
 * @param row - The row being retired, as re-read.
 * @param view - The farewell render.
 * @param context - Embed chrome.
 * @returns True when the post was edited or is unreachable for good; false
 *   when Discord merely could not answer and the row should stay open.
 */
async function edited(
  deps: RetireRowDeps,
  row: LfmMessageRow,
  view: LfmGroupView,
  context: EmbedContext,
): Promise<boolean> {
  try {
    await deps.editThread(row, view, context);
    return true;
  } catch (err) {
    const permanent = isPermanentRefusal(err);
    deps.warn(
      `Could not retire the LFG board post for game ${String(row.gameId)}: ` +
        `${describeError(err)}. ${
          permanent
            ? 'Discord says it is gone for good, so the row is closed ' +
              'anyway — an unclosable open row would wedge the game.'
            : 'Treating it as transient: the row stays OPEN so the ' +
              'reconnect reconciliation retries it.'
        }`,
    );
    return permanent;
  }
}
