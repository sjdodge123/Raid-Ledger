/**
 * Where the poll visit came from (ROK-1550).
 *
 * The Discord poll card links to `?src=discord`, so votes cast off the card
 * can be told apart from votes cast on the site. The page reads the param but
 * never rewrites it — AC4: nothing about the URL or the UI changes.
 */
import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { ScheduleVoteSource } from '@raid-ledger/contract';

/** The query parameter the Discord poll card appends to its link. */
export const VOTE_SOURCE_PARAM = 'src';

/**
 * Map a raw `?src` value onto a source the server accepts.
 *
 * The vote endpoint 400s anything outside its enum, so a URL value is NEVER
 * forwarded as-is: only the exact string `discord` is honoured, and every
 * other value — absent, empty, differently cased, padded, unknown — is the
 * ordinary web vote.
 */
export function voteSourceFromParam(value: string | null): ScheduleVoteSource {
  return value === 'discord' ? 'discord' : 'web';
}

/** The source captured for one poll, keyed by the route that identified it. */
interface VoteSourceCapture {
  /** The poll's path — `/lineups/:lineupId/schedule/:matchId`. */
  key: string;
  source: ScheduleVoteSource;
}

/**
 * The vote source for the poll currently on screen.
 *
 * Two behaviours, and the fix lives in the tension between them:
 *
 * 1. The capture SURVIVES the page rewriting its own query string (the
 *    game-time check and the lock deep-link both call `setSearchParams`), so
 *    the attribution is not lost halfway through the visit.
 * 2. The capture is PER POLL, not per mount (ROK-1550 review fix). React
 *    Router reuses this component instance across an in-app link from one
 *    poll to another, so a mount-only capture kept sending poll B's votes as
 *    `discord` because poll A had been opened from the card.
 *
 * The path is the poll's identity (it carries both the lineup and the match
 * id) and, unlike the search string, only changes when the viewer actually
 * moves to a different poll — so it is the reset key, and `?src` is re-read
 * at exactly that moment. Adjusting state during render is React's documented
 * alternative to a `useEffect` here: no wasted commit, and no render where the
 * hook reports the previous poll's source.
 */
export function useVoteSource(): ScheduleVoteSource {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [captured, setCaptured] = useState<VoteSourceCapture>(() => ({
    key: pathname,
    source: voteSourceFromParam(searchParams.get(VOTE_SOURCE_PARAM)),
  }));

  if (captured.key !== pathname) {
    const source = voteSourceFromParam(searchParams.get(VOTE_SOURCE_PARAM));
    setCaptured({ key: pathname, source });
    return source;
  }
  return captured.source;
}
