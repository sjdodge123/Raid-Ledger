/**
 * ROK-1837 — the game-server hub's Map tab (lazy chunk entry). Character and
 * world pickers above the map; the selection lives in the query string
 * (D2: `?vc=<characterId>&vm=<mapId>`), the tab in the hash (`useHashTab`).
 */
import { useId } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
    ValheimCharacterMapRef,
    ValheimCharacterSummary,
} from '@raid-ledger/contract';
import { Select } from '../../../components/ui/select';
import { useAuth } from '../../../hooks/use-auth';
import {
    useValheimCharacterMaps,
    useValheimServerCharacters,
} from '../hooks/use-valheim-map-characters';
import {
    CHARACTER_PARAM,
    MAP_PARAM,
    pickCharacterId,
    pickMapId,
    sortByName,
    worldLabel,
} from './map-selection';
import { ValheimMapView } from './valheim-map-view';
import { MapError } from './map-error';

export interface ValheimMapTabProps {
    /** The hub's Pelican server id. */
    serverId: number;
}

function Empty({ text }: { text: string }) {
    return (
        <div className="py-12 text-center">
            <p className="text-sm text-muted">{text}</p>
        </div>
    );
}

/** Write the selection to the query string, keeping the `#map` hash. */
function useSelectionWriter() {
    const location = useLocation();
    const navigate = useNavigate();
    return (characterId: number, mapId: number | null) => {
        const params = new URLSearchParams(location.search);
        params.set(CHARACTER_PARAM, String(characterId));
        if (mapId === null) params.delete(MAP_PARAM);
        else params.set(MAP_PARAM, String(mapId));
        navigate(
            { search: `?${params.toString()}`, hash: location.hash },
            { replace: true },
        );
    };
}

interface PickerProps {
    id: string;
    label: string;
    value: number;
    options: { id: number; label: string }[];
    onPick: (id: number) => void;
}

function Picker({ id, label, value, options, onPick }: PickerProps) {
    return (
        <label htmlFor={id} className="grid gap-1 text-sm text-foreground">
            {label}
            <Select
                id={id}
                value={String(value)}
                onChange={(e) => onPick(Number(e.target.value))}
            >
                {options.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                        {o.label}
                    </option>
                ))}
            </Select>
        </label>
    );
}

interface PickersProps {
    rows: ValheimCharacterSummary[];
    characterId: number;
    maps: ValheimCharacterMapRef[];
    mapId: number | null;
}

function Pickers({ rows, characterId, maps, mapId }: PickersProps) {
    const write = useSelectionWriter();
    const idBase = useId();
    const characters = sortByName(rows).map((r) => ({
        id: r.id,
        label: r.name,
    }));
    return (
        <div className="flex flex-wrap gap-3">
            <Picker
                id={`${idBase}-character`}
                label="Character"
                value={characterId}
                options={characters}
                onPick={(id) => write(id, null)}
            />
            {maps.length > 1 && mapId !== null && (
                <Picker
                    id={`${idBase}-world`}
                    label="World"
                    value={mapId}
                    options={maps.map((m) => ({
                        id: m.id,
                        label: worldLabel(m),
                    }))}
                    onPick={(id) => write(characterId, id)}
                />
            )}
        </div>
    );
}

/** The selected character's world picker + map, once the character list is in. */
function CharacterMap({
    rows,
    characterId,
    param,
}: {
    rows: ValheimCharacterSummary[];
    characterId: number;
    param: string | null;
}) {
    const detail = useValheimCharacterMaps(characterId);
    const maps = detail.data?.id === characterId ? detail.data.maps : [];
    const mapId = pickMapId(maps, param);
    return (
        <div className="grid gap-3">
            <Pickers
                rows={rows}
                characterId={characterId}
                maps={maps}
                mapId={mapId}
            />
            {mapId !== null && (
                <ValheimMapView characterId={characterId} mapId={mapId} />
            )}
            {detail.error && (
                <MapError
                    text="This character's maps could not be loaded."
                    onRetry={() => void detail.refetch()}
                />
            )}
            {mapId === null && detail.isSuccess && (
                <Empty text="This character has no map uploaded yet." />
            )}
        </div>
    );
}

/** The character list is in: pick the selected character (query, own, first). */
function ServerCharacters({
    rows,
    params,
}: {
    rows: ValheimCharacterSummary[];
    params: URLSearchParams;
}) {
    const viewerId = useAuth().user?.id ?? null;
    const characterId = pickCharacterId(
        rows,
        params.get(CHARACTER_PARAM),
        viewerId,
    );
    if (characterId === null) {
        return (
            <Empty text="No characters on this server yet. Join with the Valheim Link mod to upload one." />
        );
    }
    return (
        <CharacterMap
            rows={rows}
            characterId={characterId}
            param={params.get(MAP_PARAM)}
        />
    );
}

export function ValheimMapTab({ serverId }: ValheimMapTabProps) {
    const params = new URLSearchParams(useLocation().search);
    const characters = useValheimServerCharacters(serverId);
    if (characters.isPending)
        return (
            <div
                aria-busy="true"
                aria-label="Loading characters"
                className="h-24"
            />
        );
    if (characters.error)
        return (
            <Empty text="Characters could not be loaded. Try again later." />
        );
    return <ServerCharacters rows={characters.data} params={params} />;
}

export default ValheimMapTab;
