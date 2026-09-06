/**
 * ROK-1479 A7 — the "Right now" strip on the LFG group page.
 *
 * The operator's ruling, verbatim: the group page shows the members who are
 * looking RIGHT NOW ahead of the weekly ones, with their remaining time — a
 * small strip of `🔥 kestrel · 24 min left` chips above the existing avatar
 * row, sorted by soonest expiry. Weekly members stay in the avatar row exactly
 * as they are today, so this is an ADDITION to the status bar rather than the
 * roster list an earlier draft (D12) proposed.
 *
 * Every chip shares ONE countdown (`useNowTick`), and the hook is called with
 * the now-members' instants — an empty list means no interval at all, which is
 * what makes mounting this on every group free (D11).
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { useNowTick } from '../../hooks/use-now-tick';
import { LFG_COPY, expiresIn, nowChip } from './lfg-copy';

const CHIP_CLS =
    'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400';

export interface LfgNowStripProps {
    /** The whole roster — the strip picks its own members out of it. */
    members: readonly LfgMemberDto[];
}

/**
 * The `now` members, soonest to lapse first.
 *
 * Sorted on a copy: `members` comes straight off a TanStack Query cache entry
 * and an in-place sort would mutate cached data other components read.
 *
 * @param members - The group's whole roster.
 */
function nowMembers(members: readonly LfgMemberDto[]): LfgMemberDto[] {
    return members
        .filter((member) => member.urgency === 'now')
        .slice()
        .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/** One member's chip: who, and how long they are up for. */
function NowChip({
    member,
    now,
}: {
    member: LfgMemberDto;
    now: number;
}): JSX.Element {
    const remaining = expiresIn(Date.parse(member.expiresAt) - now);
    const name = member.displayName ?? member.username;
    // The chip IS the `<time>`: the exact instant stays available to anything
    // that wants it (and to a reader between ticks) without a second element
    // splitting the sentence in two.
    return (
        <time
            data-testid="lfg-now-chip"
            dateTime={member.expiresAt}
            className={CHIP_CLS}
        >
            {nowChip(name, remaining)}
        </time>
    );
}

/**
 * The strip. Renders nothing — and mounts no timer — when nobody in the roster
 * wants to play right now.
 *
 * @param props.members - The group's whole roster, both urgencies.
 */
export function LfgNowStrip({ members }: LfgNowStripProps): JSX.Element | null {
    const candidates = nowMembers(members);
    const now = useNowTick(candidates.map((member) => member.expiresAt));
    // A member whose window has closed is dropped HERE rather than waiting for
    // the server: `useLfgGroup` holds a 60 s `staleTime` and no refetch
    // interval, so an idle page would otherwise sit on a `0s left` chip
    // indefinitely. Dropping the last one also empties the tracked list, which
    // is what lets the shared interval retire (D11).
    const rows = candidates.filter(
        (member) => Date.parse(member.expiresAt) > now,
    );

    if (rows.length === 0) return null;
    return (
        <div
            data-testid="lfg-now-strip"
            className="flex flex-wrap items-center gap-2 pb-2"
        >
            <span className="text-xs font-semibold uppercase text-muted">
                {LFG_COPY.nowStripTitle}
            </span>
            {rows.map((member) => (
                <NowChip key={member.userId} member={member} now={now} />
            ))}
        </div>
    );
}
