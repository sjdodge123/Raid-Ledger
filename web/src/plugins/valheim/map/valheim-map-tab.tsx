/**
 * ROK-1837 — the game-server hub's Map tab (lazy chunk entry). Character and
 * world pickers above the map; the selection lives in the query string
 * (D2: `?vc=<characterId>&vm=<mapId>`), the tab in the hash (`useHashTab`).
 */
import { useLocation, useNavigate } from 'react-router-dom';
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
        navigate({ search: `?${params.toString()}`, hash: location.hash }, { replace: true });
    };
}

interface PickerProps { id: string; label: string; value: number; options: { id: number; label: string }[]; onPick: (id: number) => void }

function Picker({ id, label, value, options, onPick }: PickerProps) {
    return (
        <label htmlFor={id} className="grid gap-1 text-sm text-foreground">
            {label}
            <Select id={id} value={String(value)} onChange={(e) => onPick(Number(e.target.value))}>
                {options.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
            </Select>
        </label>
    );
}

export function ValheimMapTab({ serverId }: ValheimMapTabProps) {
    const params = new URLSearchParams(useLocation().search);
    const viewerId = useAuth().user?.id ?? null;
    const characters = useValheimServerCharacters(serverId);
    const rows = characters.data ?? [];
    const characterId = pickCharacterId(rows, params.get(CHARACTER_PARAM), viewerId);
    const detail = useValheimCharacterMaps(characterId);
    const maps = detail.data?.id === characterId ? detail.data.maps : [];
    const mapId = pickMapId(maps, params.get(MAP_PARAM));
    const write = useSelectionWriter();
    if (characters.isPending) return <div aria-busy="true" aria-label="Loading characters" className="h-24" />;
    if (characters.error) return <Empty text="Characters could not be loaded. Try again later." />;
    if (characterId === null) return <Empty text="No characters on this server yet. Join with the Valheim Link mod to upload one." />;
    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap gap-3">
                <Picker id="valheim-map-character" label="Character" value={characterId}
                    options={sortByName(rows).map((r) => ({ id: r.id, label: r.name }))} onPick={(id) => write(id, null)} />
                {maps.length > 1 && mapId !== null && (
                    <Picker id="valheim-map-world" label="World" value={mapId}
                        options={maps.map((m) => ({ id: m.id, label: worldLabel(m) }))} onPick={(id) => write(characterId, id)} />
                )}
            </div>
            {mapId !== null && <ValheimMapView characterId={characterId} mapId={mapId} />}
            {mapId === null && !detail.isPending && <Empty text="This character has no map uploaded yet." />}
        </div>
    );
}

export default ValheimMapTab;
