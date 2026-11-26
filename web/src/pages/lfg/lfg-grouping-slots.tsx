/**
 * ROK-2352 — where the active `lfg-grouping` plugin renders on the LFG page.
 * Both render nothing for a game with no active grouping, so every other game
 * (and WoW with its plugin off) shows exactly today's page.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import { useLfgGameGroups } from '../../hooks/use-lfg-game-groups';

interface SlotProps {
    grouping: LfgGrouping | null;
    context: LfgGroupingContext;
}

/** The plugin's header controls (the hub picker). */
export function LfgGroupingHeader({ grouping, context }: SlotProps): JSX.Element | null {
    const Header = grouping?.HeaderControls;
    return Header ? <Header {...context} /> : null;
}

/** The plugin's group list — only on the whole-game (`''`) page. */
export function LfgGroupingList({ grouping, context }: SlotProps): JSX.Element | null {
    const Sections = grouping?.GroupSections;
    const onWholeGame = context.groupKey === '';
    const groups = useLfgGameGroups(context.gameId, Boolean(Sections) && onWholeGame);
    if (!Sections || !onWholeGame) return null;
    return <Sections context={context} groups={groups.data?.groups ?? []} isLoading={groups.isLoading} />;
}

/** The plugin's section for a keyed group (`/lfg/<game>/<key>`) — never the whole-game page. */
export function LfgGroupingPageSection({ grouping, context, group }: SlotProps & { group: LfgGroupDetailDto }): JSX.Element | null {
    const Section = grouping?.GroupPageSection;
    if (!Section || context.groupKey === '') return null;
    return <Section context={context} group={group} />;
}

