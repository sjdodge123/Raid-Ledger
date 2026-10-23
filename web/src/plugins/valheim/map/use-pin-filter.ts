/**
 * ROK-1930 L4 — the Map view's pin-type filter wiring: reads `?pins=` (D10),
 * writes it in the `useSelectionWriter` style (`replace: true`, hash kept), and
 * fetches the "Show all" layer. Kept out of `valheim-map-view.tsx` (size budget).
 */
import { useLocation, useNavigate } from 'react-router-dom';
import type { ValheimMapMeta, ValheimMapPin } from '@raid-ledger/contract';
import { useValheimDeathPins } from '../hooks/use-valheim-death-pins';
import { filterPins, parsePinFilter, writePinFilter, type PinFilter } from './pin-filter';

export interface PinFilterArgs {
    characterId: number;
    /** The hub's Pelican server; without it (character page) "Show all" falls back to the character. */
    serverId?: number | undefined;
    meta: ValheimMapMeta;
}

export interface PinFilterBarState {
    scope: 'character' | 'server';
    count: number;
    loading: boolean;
    onClear: () => void;
}

export interface PinFilterView {
    pins: readonly ValheimMapPin[];
    deathsOnly: boolean;
    onDeathsOnly: (on: boolean) => void;
    bar: PinFilterBarState | null;
}

function effectiveFilter(params: URLSearchParams, serverId: number | undefined): PinFilter {
    const parsed = parsePinFilter(params);
    if (parsed.deathsOnly && parsed.scope === 'server' && serverId === undefined) {
        return { deathsOnly: true, scope: 'character' };
    }
    return parsed;
}

function usePinFilterWriter(characterId: number) {
    const location = useLocation();
    const navigate = useNavigate();
    return (on: boolean) => {
        const next = writePinFilter(new URLSearchParams(location.search), on, characterId);
        const search = next.toString();
        navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    };
}

export function usePinFilter({ characterId, serverId, meta }: PinFilterArgs): PinFilterView {
    const filter = effectiveFilter(new URLSearchParams(useLocation().search), serverId);
    const write = usePinFilterWriter(characterId);
    const showAll = filter.deathsOnly && filter.scope === 'server';
    const server = useValheimDeathPins(serverId ?? 0, meta.worldUid, showAll);
    const pins = filterPins(meta.pins, filter, server.data?.pins);
    const bar: PinFilterBarState | null = filter.deathsOnly
        ? { scope: filter.scope, count: pins.length, loading: showAll && server.isPending, onClear: () => write(false) }
        : null;
    return { pins, deathsOnly: filter.deathsOnly, onDeathsOnly: write, bar };
}
