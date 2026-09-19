/**
 * Where the poll visit came from (ROK-1550).
 *
 * The Discord poll card links to `?src=discord`, so votes cast off the card
 * can be told apart from votes cast on the site. The page reads the param but
 * never rewrites it — AC4: nothing about the URL or the UI changes.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

/**
 * The vote source for this page visit, captured on first render.
 *
 * The capture is deliberate: the poll page rewrites its own query string
 * while the viewer is on it (the game-time check and the lock deep-link both
 * call `setSearchParams`), which would otherwise drop the attribution
 * halfway through the visit.
 */
export function useVoteSource(): ScheduleVoteSource {
  const [searchParams] = useSearchParams();
  const [source] = useState<ScheduleVoteSource>(() =>
    voteSourceFromParam(searchParams.get(VOTE_SOURCE_PARAM)),
  );
  return source;
}
