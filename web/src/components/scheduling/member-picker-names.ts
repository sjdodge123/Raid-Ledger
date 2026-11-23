/**
 * ROK-2256 — names for the member picker's Selected chips. The picker lists
 * only page 1 (or a search), so a selected member may have no visible row:
 * the caller's names win, rows the picker has loaded fill the gaps (and stay
 * remembered after a search clears), else a neutral "Member #<id>".
 */
import { useState } from 'react';

/** One pickable community member. */
export interface MemberOption {
  id: number;
  username: string;
}

/** The label for a selected id with no known name. */
export function fallbackMemberName(id: number): string {
  return `Member #${id}`;
}

/** Caller names over names learned from every list the picker has loaded. */
export function useMemberNames(
  known: readonly MemberOption[] | undefined,
  loaded: readonly MemberOption[],
): ReadonlyMap<number, string> {
  const [learned, setLearned] = useState<ReadonlyMap<number, string>>(() => toNameMap(loaded));
  const [seen, setSeen] = useState(loaded);
  // React's "adjust state while rendering" pattern: learn each newly loaded list once.
  if (seen !== loaded) {
    setSeen(loaded);
    setLearned((prev) => new Map([...prev, ...toNameMap(loaded)]));
  }
  const names = new Map(learned);
  for (const m of known ?? []) names.set(m.id, m.username);
  return names;
}

function toNameMap(members: readonly MemberOption[]): Map<number, string> {
  return new Map(members.map((m): [number, string] => [m.id, m.username]));
}
