/**
 * Events-page aggregate LFG banner (ROK-1453 AC3).
 *
 * One line: how many games currently have somebody looking. Renders NOTHING
 * when nobody is looking — the events banner stack is scrolled past on mobile
 * (`game-detail.smoke.spec.ts`), so a zero-height placeholder would shift the
 * layout for no information.
 *
 * ROK-1478 AC3 splits it in two. With 2+ games it still links to the Library
 * filtered to exactly those games (`/games?lfg=1`) with byte-identical copy.
 * With exactly ONE, that hop was a dead end — the filtered Library showed a
 * single tile whose badge went where the banner could have gone directly — so
 * the banner names the game, describes the group with the SAME sentence the
 * card badge uses (`lfg-chip-copy.ts`, D4, so the two can never disagree), and
 * links straight at `/lfg/{gameSlug}`.
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
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { useLfgGroups } from '../../hooks/use-lfg-groups';
import { effectiveLfgState, groupLine, nowLine } from '../lfg/lfg-chip-copy';

const BOX_CLS =
    'block mx-4 mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors';

/**
 * `N games have players looking` — only ever reached with 2+ games now that
 * one game has its own, more useful sentence.
 */
function summaryText(count: number): string {
    return `${count} games have players looking`;
}

/**
 * ROK-1479 A9 — how many PLAYERS want to play right now, across every group.
 *
 * Players, not games, because urgency is about people who are free; the games
 * line above it keeps counting games and is deliberately not edited.
 *
 * @param groups - Every row of `GET /lfg`.
 */
function totalNowPlayers(groups: readonly LfgGroupSummaryDto[]): number {
    return groups.reduce((sum, group) => sum + group.nowCount, 0);
}

/**
 * The second line. Absent entirely at zero — a banner that said "0 want to
 * play now" would be noise on the surface this component exists to keep quiet.
 *
 * @param nowCount - Players wanting to play right now, across every group.
 */
function NowLine({ nowCount }: { nowCount: number }): JSX.Element | null {
    if (nowCount <= 0) return null;
    return (
        <span
            data-testid="lfg-summary-banner-now"
            className="text-sm font-semibold text-amber-400"
        >
            {nowLine(nowCount)}
        </span>
    );
}

/** Line one: the games headline and its call to action, side by side. */
function HeadlineRow({
    headline,
    cta,
}: {
    headline: string;
    cta: string;
}): JSX.Element {
    return (
        <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-amber-400">
                {headline}
            </span>
            <span
                data-testid="lfg-summary-banner-cta"
                className="text-xs text-amber-400/80"
            >
                {cta}
            </span>
        </span>
    );
}

/** The banner's shape: one link, one headline, one call to action. */
function BannerLink({
    to,
    headline,
    cta,
    nowCount,
}: {
    to: string;
    headline: string;
    cta: string;
    /** Players wanting to play right now; the second line, when above zero. */
    nowCount: number;
}): JSX.Element {
    return (
        <Link to={to} data-testid="lfg-summary-banner" className={BOX_CLS}>
            {/*
              The now line is a SIBLING of the headline row, not a third item
              inside it: as a child it wrapped inline between the headline and
              its own call to action on a wide viewport. Headline and CTA stay
              together on line one; the now line is line two.
            */}
            <span className="flex flex-col gap-1">
                <HeadlineRow headline={headline} cta={cta} />
                <NowLine nowCount={nowCount} />
            </span>
        </Link>
    );
}

/** The single-game banner: name the game, then link straight at its group. */
function SingleGroupBanner({
    group,
    nowCount,
}: {
    group: LfgGroupSummaryDto;
    nowCount: number;
}): JSX.Element {
    const line = groupLine(
        group.activeCount,
        effectiveLfgState(group.activeCount, group.state),
        group.viabilityThreshold,
    );
    return (
        <BannerLink
            to={`/lfg/${group.gameSlug}`}
            headline={`🎯 ${group.gameName} · ${line}`}
            cta="Join →"
            nowCount={nowCount}
        />
    );
}

/** Banner linking at the one group, or at the LFG-filtered Library view. */
export function LfgSummaryBanner(): JSX.Element | null {
    const { data } = useLfgGroups();
    const groups = data ?? [];

    if (groups.length === 0) return null;
    const nowCount = totalNowPlayers(groups);
    if (groups.length === 1) {
        return <SingleGroupBanner group={groups[0]} nowCount={nowCount} />;
    }

    return (
        <BannerLink
            to="/games?lfg=1"
            headline={`🎯 ${summaryText(groups.length)}`}
            cta="Browse them →"
            nowCount={nowCount}
        />
    );
}
