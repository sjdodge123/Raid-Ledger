/**
 * ROK-1483 D13 — the capped backwards walk of a thread's history.
 *
 * Extracted from the service because it is the one piece of the mirror that is
 * pure paging arithmetic: given something that can `fetch` pages, produce the
 * newest `MAX_BACKFILL_MESSAGES` messages in render order. It owns no db
 * handle and no Discord client, so its cap and its ordering are unit-testable
 * without either.
 */
import { MAX_BACKFILL_MESSAGES } from './thread-mirror.constants';
import {
  snowflakeToSortKey,
  type MirrorSourceMessage,
} from './thread-mirror.helpers';

/** How many messages one `messages.fetch` may ask for — Discord's own ceiling. */
const PAGE_SIZE = 100;

/**
 * The structural slice of a discord.js `ThreadChannel` the walk needs.
 *
 * Structural for the same reason `MirrorSourceMessage` is: a `ThreadChannel`
 * cannot be constructed without a client, so typing against it would put a
 * gateway fixture between every cap test and the arithmetic it is testing.
 */
export interface BackfillThread {
  messages: {
    fetch(options: {
      limit: number;
      before?: string;
    }): Promise<ReadonlyMap<string, MirrorSourceMessage>>;
  };
}

/** What one capped walk found. */
export interface BackfillResult {
  /** Oldest first — the order the rows are inserted and rendered in. */
  messages: MirrorSourceMessage[];
  /** True when the cap stopped the walk, so older history stays in Discord. */
  truncated: boolean;
}

/** One page of messages, newest-first as Discord returns them. */
async function fetchPage(
  thread: BackfillThread,
  before: string | undefined,
): Promise<MirrorSourceMessage[]> {
  const page = await thread.messages.fetch({
    limit: PAGE_SIZE,
    ...(before === undefined ? {} : { before }),
  });
  return [...page.values()];
}

/** The oldest message of a page, by snowflake — the next `before` cursor. */
function oldestOf(page: MirrorSourceMessage[]): MirrorSourceMessage {
  return page.reduce((oldest, message) =>
    snowflakeToSortKey(message.id) < snowflakeToSortKey(oldest.id)
      ? message
      : oldest,
  );
}

/**
 * Walk a thread backwards from its newest message, capped at
 * {@link MAX_BACKFILL_MESSAGES}.
 *
 * Backwards rather than forwards because the newest messages are the ones the
 * panel renders first, and a forwards walk of a thread over the cap would
 * mirror exactly the history nobody scrolls to. The `before` cursor is derived
 * by snowflake comparison rather than by trusting the page's iteration order.
 *
 * @param thread - Anything that can fetch pages of messages.
 * @returns The messages oldest-first plus whether the cap truncated the walk.
 */
export async function collectBackfillMessages(
  thread: BackfillThread,
): Promise<BackfillResult> {
  const collected: MirrorSourceMessage[] = [];
  let before: string | undefined;
  let exhausted = false;

  while (collected.length < MAX_BACKFILL_MESSAGES) {
    const page = await fetchPage(thread, before);
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    collected.push(...page);
    before = oldestOf(page).id;
    if (page.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  // Truncated means the CAP stopped the walk, not that the thread ran out:
  // a walk that ended on a short page has the whole history and must not
  // footer the panel with "older messages are in Discord".
  const ascending = collected.sort((a, b) =>
    snowflakeToSortKey(a.id) < snowflakeToSortKey(b.id) ? -1 : 1,
  );
  return {
    messages: ascending.slice(
      Math.max(0, ascending.length - MAX_BACKFILL_MESSAGES),
    ),
    truncated: !exhausted,
  };
}
