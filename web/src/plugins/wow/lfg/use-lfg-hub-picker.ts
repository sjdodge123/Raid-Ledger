/**
 * ROK-2352 §3.6 — the WoW LFG hub picker's state: the viewer's WoW hubs
 * (`GET /guilds/mine`, game slug resolved through the game registry), the
 * hub `?hub` names, and the pick action. The URL is the source of truth; the
 * remembered last pick only pre-selects when the page opens without `?hub`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMyGuildsQuery } from '../../../components/layout/hub-nav/my-hubs-queries';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import type { LfgGroupingContext } from '../../lfg-grouping';
import {
    matchHub, readLastHub, variantName, wowHubOptions, writeLastHub, type WowHubOption,
} from './lfg-hub-picker-state';

/** The `Select` value for "All of <variant>" (no hub). */
export const ALL_HUBS_VALUE = 'all';

/** What the picker renders. */
export interface LfgHubPickerState {
    /** False until both the hubs and the game registry have settled. */
    ready: boolean;
    options: WowHubOption[];
    /** The `?hub` option when its game is the page's game. */
    selected: WowHubOption | null;
    /** `?hub` is set but names no hub of this page's game — it is ignored. */
    mismatched: boolean;
    /** The page game's display name, for "All of <variant>". */
    variantLabel: string;
    /** Apply a `Select` value: {@link ALL_HUBS_VALUE} or a hub id. */
    pick: (value: string) => void;
}

/** State + actions for {@link LfgHubPicker}; see the module doc. */
export function useLfgHubPicker(ctx: LfgGroupingContext): LfgHubPickerState {
    const hubs = useMyGuildsQuery();
    const { games, isLoading } = useGameRegistry();
    const ready = hubs.isSuccess && !isLoading;
    const options = useMemo(() => wowHubOptions(hubs.data?.guilds ?? [], games), [hubs.data, games]);
    const selected = matchHub(ctx.hubId, options, ctx.gameSlug);
    const pick = usePick(ctx.gameSlug, options);
    usePreselectRemembered(ready, ctx, options);
    return {
        ready, options, selected,
        mismatched: ctx.hubId !== null && selected === null,
        variantLabel: variantName(ctx.gameSlug, games) ?? 'this game',
        pick,
    };
}

/** Writes the pick into the URL (other variant → that variant's page) and remembers it. */
function usePick(pageSlug: string, options: readonly WowHubOption[]): (value: string) => void {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    return (value: string): void => {
        const next = new URLSearchParams(params);
        if (value === ALL_HUBS_VALUE) {
            writeLastHub(null);
            next.delete('hub');
            setParams(next);
            return;
        }
        const option = options.find((o) => String(o.hubId) === value);
        if (!option) return;
        writeLastHub(option.hubId);
        if (option.gameSlug !== pageSlug) {
            navigate(`/lfg/${encodeURIComponent(option.gameSlug)}?hub=${option.hubId}`);
            return;
        }
        next.set('hub', String(option.hubId));
        setParams(next);
    };
}

/** Once settled with no `?hub`, put the remembered hub in the URL if it is this page's game. */
function usePreselectRemembered(
    ready: boolean,
    ctx: LfgGroupingContext,
    options: readonly WowHubOption[],
): void {
    const [params, setParams] = useSearchParams();
    const done = useRef(false);
    useEffect(() => {
        if (!ready || done.current) return;
        done.current = true;
        if (ctx.hubId !== null) return;
        const remembered = matchHub(readLastHub(), options, ctx.gameSlug);
        if (!remembered) return;
        const next = new URLSearchParams(params);
        next.set('hub', String(remembered.hubId));
        setParams(next, { replace: true });
    }, [ready, ctx.hubId, ctx.gameSlug, options, params, setParams]);
}
