/**
 * ROK-2272 S8 (R7, R11) — every user-facing string of the inbound write
 * gate's DM. The event text is the ROK-2208 ruled copy, moved verbatim; the
 * poll and lineup texts mirror it (operator-ruled style).
 */
import type { GateSubjectKind } from './hub-forum-discord-subject-gate.facts';

/** The title used when the subject row is gone. */
export const SUBJECT_FALLBACK_TITLE: Readonly<Record<GateSubjectKind, string>> =
  {
    event: 'this event',
    poll: 'this poll',
    lineup: 'this lineup',
  };

/** The ruled event DM copy (ROK-2208, unchanged). */
export function eventNoticeText(title: string, url: string): string {
  return `Only players signed up for ${title} can post in its discussion. Join Raid Ledger and sign up: ${url}`;
}

/** The poll DM copy. */
export function pollNoticeText(title: string, url: string): string {
  return `Only players who voted in ${title} can post in its discussion. Join Raid Ledger and vote: ${url}`;
}

/** The lineup DM copy. */
export function lineupNoticeText(title: string, url: string): string {
  return `Only players who nominated or voted in ${title} can post in its discussion. Join Raid Ledger and take part: ${url}`;
}

/** The DM text for one subject kind. */
export function subjectNoticeText(
  kind: GateSubjectKind,
  title: string,
  url: string,
): string {
  if (kind === 'poll') return pollNoticeText(title, url);
  if (kind === 'lineup') return lineupNoticeText(title, url);
  return eventNoticeText(title, url);
}
