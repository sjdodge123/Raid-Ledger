/**
 * ROK-2352 — where the active `lfg-grouping` plugin renders on the LFG page.
 * Both render nothing for a game with no active grouping, so every other game
 * (and WoW with its plugin off) shows exactly today's page.
 */
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import { useLfgGameGroups } from '../../hooks/use-lfg-game-groups';

/** `?hub=<id>` as a positive integer, else null (§3.6: the URL is the source of truth). */
export function parseHubParam(raw: string | null): number | null {
    if (raw == null || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return id > 0 ? id : null;
}

/** The page's `?hub`, read from the URL. */
export function useLfgHubParam(): number | null {
    const [params] = useSearchParams();
    return parseHubParam(params.get('hub'));
}

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
