/**
 * ROK-1905 (plan §2.1) — header `action`s for the Forever widgets that
 * truncate: a "See all" jump to the hub tab that holds the full list. The
 * Members tab has no URL-driven filter yet, so these are plain tab jumps.
 */
import type { JSX } from 'react';
import { FOCUS_RING } from '../../../components/ui/form-classes';

function SeeAll({ href, testId }: { href: string; testId: string }): JSX.Element {
    return (
        <a href={href} data-testid={testId}
            className={`inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            See all
        </a>
    );
}

/** Level progression (top-5 names) → the Members tab. */
export function MembersSeeAll(): JSX.Element {
    return <SeeAll href="#members" testId="forever-see-all-members" />;
}

/** Dungeon quests (next 3 events) → the Events tab. */
export function EventsSeeAll(): JSX.Element {
    return <SeeAll href="#events" testId="forever-see-all-events" />;
}
