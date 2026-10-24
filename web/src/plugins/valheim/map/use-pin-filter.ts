/**
 * ROK-1943 — the Map view's pin filter wiring: reads the four URL filters
 * (D9/D10), writes them in the `useSelectionWriter` style (`replace: true`,
 * hash kept), and fetches the cross-player layer in a players scope. Without a
 * `serverId` (character page) the scope is always this character.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import type { ValheimMapMeta, ValheimMapPin } from '@raid-ledger/contract';
import { useValheimServerPins } from '../hooks/use-valheim-server-pins';
import {
    activeFilterCount, clearPinFilters, filterPins, parsePinFilter, toggleType, writePinFilter, type PinFilter,
} from './pin-filter';
import { layerStatus, type PinFilterSummary } from './pin-filter-summary';
import { rawTypesFor, type PinTypeGroupId } from './pin-type-groups';

export type { PinFilterSummary, PinLayerStatus } from './pin-filter-summary';

export interface PinFilterArgs {
    characterId: number;
    /** The hub's Pelican server; without it (character page) the players scope is unavailable. */
    serverId?: number | undefined;
    meta: ValheimMapMeta;
}

/** Everything the filter panel (lane C2) reads and calls. */
export interface PinFilterPanelState {
    filter: PinFilter;
    /** False on the character page — hide the "Whose pins" section. */
    playersAvailable: boolean;
    activeCount: number;
    onChange: (patch: Partial<PinFilter>) => void;
    onToggleType: (id: PinTypeGroupId) => void;
    /** "Clear all": the four filters to default, `vc`/`vm` kept. */
    onClearAll: () => void;
}

export interface PinFilterView {
    pins: readonly ValheimMapPin[];
    panel: PinFilterPanelState;
    summary: PinFilterSummary;
}

function effectiveFilter(params: URLSearchParams, serverId: number | undefined): PinFilter {
    const parsed = parsePinFilter(params);
    return serverId === undefined ? { ...parsed, players: 'character' } : parsed;
}

function useUrlWriter(): (write: (params: URLSearchParams) => URLSearchParams) => void {
    const location = useLocation();
    const navigate = useNavigate();
    return (write) => {
        const search = write(new URLSearchParams(location.search)).toString();
        navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    };
}

function usePanel(filter: PinFilter, characterId: number, serverId: number | undefined): PinFilterPanelState {
    const write = useUrlWriter();
    const onChange = (patch: Partial<PinFilter>): void => write((p) => writePinFilter(p, patch, characterId));
    return {
        filter, playersAvailable: serverId !== undefined, activeCount: activeFilterCount(filter), onChange,
        onToggleType: (id) => onChange({ types: toggleType(filter.types, id) }),
        onClearAll: () => write((p) => clearPinFilters(p, characterId)),
    };
}

/** The Map view's pin filter: the pins to draw, the panel state and the summary line. */
export function usePinFilter({ characterId, serverId, meta }: PinFilterArgs): PinFilterView {
    const filter = effectiveFilter(new URLSearchParams(useLocation().search), serverId);
    const panel = usePanel(filter, characterId, serverId);
    const players = filter.players === 'character' ? 'all' : filter.players;
    const layerOn = filter.players !== 'character';
    const types = rawTypesFor(filter.types);
    const server = useValheimServerPins({ serverId: serverId ?? 0, worldUid: meta.worldUid, players, types }, layerOn);
    const pins = filterPins(meta.pins, filter, server.data?.pins);
    const summary: PinFilterSummary = {
        activeCount: panel.activeCount, count: pins.length, status: layerStatus(server, layerOn),
        truncated: layerOn && server.data?.truncated === true,
        onRetry: () => void server.refetch(), onClear: panel.onClearAll,
    };
    return { pins, panel, summary };
}
