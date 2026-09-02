/**
 * Events-page aggregate LFG banner (ROK-1453 AC3).
 *
 * One line: how many games currently have somebody looking, linking to the
 * Library filtered to exactly those games (`/games?lfg=1`). Renders NOTHING
 * when nobody is looking — the events banner stack is scrolled past on mobile
 * (`game-detail.smoke.spec.ts`), so a zero-height placeholder would shift the
 * layout for no information.
 *
 * Amber tonal tokens keep it distinct from the emerald scheduling banner
 * directly above it.
 *
 * LAYOUT (operator walk): the box metrics are copied from
 * `SchedulingBanner.tsx:43` / `standalone-poll-banner.tsx:37` —
 * `mx-4 mb-4 p-4 rounded-xl`. All three banners render OUTSIDE the page's
 * `max-w-7xl` container (`events-page.tsx:110-114`), so full-bleed IS the
 * house style here and matching the siblings beats matching the content
 * column. What was wrong was `justify-between`, which flung "Browse them →"
 * to the far edge of a wide screen; the siblings keep their content in a
 * left-aligned flow, so this does too.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useLfgGroups } from '../../hooks/use-lfg-groups';

/** `1 game has` / `N games have` — the copy pinned by the spec. */
function summaryText(count: number): string {
    const subject = count === 1 ? '1 game has' : `${count} games have`;
    return `${subject} players looking`;
}

/** Banner linking to the LFG-filtered Library view. */
export function LfgSummaryBanner(): JSX.Element | null {
    const { data } = useLfgGroups();
    const count = data?.length ?? 0;

    if (count === 0) return null;

    return (
        <Link
            to="/games?lfg=1"
            data-testid="lfg-summary-banner"
            className="block mx-4 mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
        >
            <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-amber-300">
                    🎯 {summaryText(count)}
                </span>
                <span className="text-xs text-amber-300/80">
                    Browse them →
                </span>
            </span>
        </Link>
    );
}
