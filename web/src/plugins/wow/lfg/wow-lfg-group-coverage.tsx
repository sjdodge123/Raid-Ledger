/**
 * ROK-2352 §4.1 — the keyed WoW group page's role coverage strip: the group's
 * roster shape (§3.4: 1/1/3 for a dungeon, 4/10/26 for a 40-man raid) and how
 * much of it the live members cover. Reads the same group-list query as the
 * group list and the lock-in preview, and reuses their `WowLfgCoverageStrip`.
 */
import type { JSX } from 'react';
import type { LfgGroupPageSectionProps } from '../../lfg-grouping';
import { useLfgGameGroups } from '../../../hooks/use-lfg-game-groups';
import { WowLfgCoverageStrip } from './wow-lfg-coverage-strip';
import { WOW_LFG_COPY } from './wow-lfg-copy';

/** The `GroupPageSection` of the WoW `lfg-grouping` registration. */
export function WowLfgGroupCoverage({ context }: LfgGroupPageSectionProps): JSX.Element | null {
    const groups = useLfgGameGroups(context.gameId, true).data?.groups ?? [];
    const item = groups.find((g) => (g.groupKey ?? '') === context.groupKey);
    if (!item?.rosterShape) return null;
    return (
        <section data-testid="wow-lfg-group-coverage" aria-labelledby="wow-lfg-group-coverage-heading"
            className="space-y-2 rounded-xl bg-surface p-4">
            <h2 id="wow-lfg-group-coverage-heading" className="text-sm font-semibold text-foreground">
                {WOW_LFG_COPY.coverageHeading}
            </h2>
            <WowLfgCoverageStrip shape={item.rosterShape} coverage={item.coverage} />
        </section>
    );
}
