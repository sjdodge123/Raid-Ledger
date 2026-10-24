/**
 * ROK-1943 — the Map view's pin filter wiring: reads the four URL filters
 * (D9/D10), writes them in the `useSelectionWriter` style (`replace: true`,
 * hash kept), and fetches the cross-player layer in a players scope. Without a
 * `serverId` (character page) the scope is always this character and there is
 * no portal layer (ROK-1946).
 */
import { useLocation, useNavigate } from 'react-router-dom';
import type { ValheimMapMeta, ValheimMapPin } from '@raid-ledger/contract';
import { useValheimServerPins } from '../hooks/use-valheim-server-pins';
import { useValheimServerPortals } from '../hooks/use-valheim-server-portals';
import {
    activeFilterCount, clearPinFilters, filterPins, parsePinFilter, toggleType, writePinFilter, type PinFilter,
} from './pin-filter';
import { layerStatus, portalLayerFailed, type PinFilterSummary } from './pin-filter-summary';
import { filterPortals } from './portal-pins';
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

interface PortalLayer {
    pins: readonly ValheimMapPin[];
    summary: Pick<PinFilterSummary, 'portalsError' | 'portalsPending' | 'portalsOmitted' | 'onRetryPortals'>;
}

/** ROK-1946: the scanned portals, filtered (D12); hub-only, and only while the chip can show them. */
function usePortalLayer(filter: PinFilter, serverId: number | undefined, worldUid: string): PortalLayer {
    const on = serverId !== undefined && (filter.types === null || filter.types.has('scanned-portal'));
    const query = useValheimServerPortals({ serverId: serverId ?? 0, worldUid }, on);
    const data = on ? query.data : undefined;
    return {
        pins: filterPortals(data?.portals ?? [], filter),
        summary: {
            portalsError: on && portalLayerFailed(query), portalsPending: on && query.isPending,
            portalsOmitted: data?.omitted ?? 0,
            onRetryPortals: () => void query.refetch(),
        },
    };
}

/** The Map view's pin filter: the pins to draw, the panel state and the summary line. */
export function usePinFilter({ characterId, serverId, meta }: PinFilterArgs): PinFilterView {
    const filter = effectiveFilter(new URLSearchParams(useLocation().search), serverId);
    const panel = usePanel(filter, characterId, serverId);
    const players = filter.players === 'character' ? 'all' : filter.players;
    const types = rawTypesFor(filter.types);
    // D13: no map chip picked (e.g. Scanned portals only) → no pins request.
    const layerOn = filter.players !== 'character' && types?.length !== 0;
    const server = useValheimServerPins({ serverId: serverId ?? 0, worldUid: meta.worldUid, players, types }, layerOn);
    const portals = usePortalLayer(filter, serverId, meta.worldUid);
    const pins = [...filterPins(meta.pins, filter, layerOn ? server.data?.pins : []), ...portals.pins];
    const summary: PinFilterSummary = {
        activeCount: panel.activeCount, count: pins.length, status: layerStatus(server, layerOn),
        truncated: layerOn && server.data?.truncated === true,
        onRetry: () => void server.refetch(), onClear: panel.onClearAll, ...portals.summary,
    };
    return { pins, panel, summary };
}
