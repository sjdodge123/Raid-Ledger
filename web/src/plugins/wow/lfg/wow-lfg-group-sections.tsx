/**
 * ROK-2352 §4.1 — the WoW group list on `/lfg/:gameSlug`: "Any dungeon"
 * first, then a Dungeons and a Raids section. Each row links to its group
 * page and shows the coverage strip sized by the instance's roster (§3.4).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import type { LfgGroupSectionsProps } from '../../lfg-grouping';
import { WowLfgCoverageStrip } from './wow-lfg-coverage-strip';
import { isFullGroup, orderWowLfgGroups } from './wow-lfg-group-order';
import { WOW_LFG_COPY, wowLfgGroupHref, wowLfgGroupLabel } from './wow-lfg-copy';

function GroupRow({ gameSlug, group }: { gameSlug: string; group: LfgGroupListItemDto }): JSX.Element {
    const key = group.groupKey ?? '';
    return (
        <li data-testid="wow-lfg-group-row" data-group-key={key}>
            <Link to={wowLfgGroupHref(gameSlug, key)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-panel px-3 py-2 hover:bg-overlay">
                <span className="text-sm font-medium text-foreground">{wowLfgGroupLabel(group)}</span>
                <span className="flex flex-wrap items-center gap-2">
                    {isFullGroup(group) && <span className="text-xs font-medium text-success">{WOW_LFG_COPY.full}</span>}
                    <span className="text-xs text-muted">{WOW_LFG_COPY.looking(group.activeCount)}</span>
                    {group.rosterShape && <WowLfgCoverageStrip shape={group.rosterShape} coverage={group.coverage} />}
                </span>
            </Link>
        </li>
    );
}

function Section({ title, testId, gameSlug, groups }: {
    title: string; testId: string; gameSlug: string; groups: readonly LfgGroupListItemDto[];
}): JSX.Element | null {
    if (groups.length === 0) return null;
    return (
        <section data-testid={testId} aria-label={title} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
            <ul className="space-y-2">
                {groups.map((g) => <GroupRow key={g.groupKey ?? ''} gameSlug={gameSlug} group={g} />)}
            </ul>
        </section>
    );
}

/** The `GroupSections` component of the WoW `lfg-grouping` registration. */
export function WowLfgGroupSections({ context, groups, isLoading }: LfgGroupSectionsProps): JSX.Element {
    const { any, dungeons, raids } = orderWowLfgGroups(groups);
    const slug = context.gameSlug;
    return (
        <div data-testid="wow-lfg-groups" className="space-y-4 rounded-xl bg-surface p-4">
            <h2 className="text-base font-semibold text-foreground">{WOW_LFG_COPY.heading}</h2>
            {isLoading && <p className="text-sm text-muted">{WOW_LFG_COPY.loading}</p>}
            {any && <ul><GroupRow gameSlug={slug} group={any} /></ul>}
            <Section title={WOW_LFG_COPY.dungeons} testId="wow-lfg-dungeons" gameSlug={slug} groups={dungeons} />
            <Section title={WOW_LFG_COPY.raids} testId="wow-lfg-raids" gameSlug={slug} groups={raids} />
        </div>
    );
}
