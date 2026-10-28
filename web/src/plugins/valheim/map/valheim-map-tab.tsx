/**
 * ROK-1837 — the game-server hub's Map tab (lazy chunk entry). Character and
 * world pickers above the map; the selection lives in the query string
 * (D2: `?vc=<characterId>&vm=<mapId>`), the tab in the hash (`useHashTab`).
 */
import { useId, type JSX } from 'react';
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
import { writeSelection } from './pin-filter';
import { MapError } from './map-error';
import { ChestFocusCard } from './chest-focus-card';
import { ChestFocusContext, useChestFocus } from './use-chest-focus';

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

/** Write the selection to the query string, keeping the `#map` hash and the pin scope. */
function useSelectionWriter() {
    const location = useLocation();
    const navigate = useNavigate();
    return (characterId: number, mapId: number | null, world: boolean) => {
        const params = writeSelection(new URLSearchParams(location.search), {
            characterId,
            mapId,
            world,
        });
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
        <label htmlFor={id} className="flex items-center gap-2 text-sm text-foreground">
            {label}
            <Select
                id={id}
                wrapperClassName="w-auto min-w-[10rem]"
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

const worldOptions = (maps: ValheimCharacterMapRef[]) =>
    maps.map((m) => ({ id: m.id, label: worldLabel(m) }));

function Pickers({ rows, characterId, maps, mapId }: PickersProps) {
    const write = useSelectionWriter();
    const idBase = useId();
    const characters = sortByName(rows).map((r) => ({
        id: r.id,
        label: r.name,
    }));
    return (
        <div className="flex flex-wrap items-center gap-3" data-testid="map-pickers">
            <Picker
                id={`${idBase}-character`}
                label="Character"
                value={characterId}
                options={characters}
                onPick={(id) => write(id, null, false)}
            />
            {maps.length > 1 && mapId !== null && (
                <Picker
                    id={`${idBase}-world`}
                    label="World"
                    value={mapId}
                    options={worldOptions(maps)}
                    onPick={(id) => write(characterId, id, true)}
                />
            )}
        </div>
    );
}

interface CharacterMapBodyProps {
    serverId: number;
    characterId: number;
    mapId: number | null;
    detail: ReturnType<typeof useValheimCharacterMaps>;
    /** ROK-2028: the pickers — inside the map's toolbar row when there is a map. */
    pickers: JSX.Element;
}

/** The map, a detail-fetch error with Retry, or the no-map empty state. */
function CharacterMapBody({ serverId, characterId, mapId, detail, pickers }: CharacterMapBodyProps) {
    if (mapId !== null)
        return <ValheimMapView serverId={serverId} characterId={characterId} mapId={mapId} toolbarStart={pickers} />;
    if (detail.error)
        return (
            <>
                {pickers}
                <MapError text="This character's maps could not be loaded." onRetry={() => void detail.refetch()} />
            </>
        );
    if (detail.isSuccess)
        return <>{pickers}<Empty text="This character has no map uploaded yet." /></>;
    return pickers;
}

/** The selected character's world picker + map, once the character list is in. */
interface CharacterMapProps {
    serverId: number;
    rows: ValheimCharacterSummary[];
    characterId: number;
    param: string | null;
}

function CharacterMap(props: CharacterMapProps) {
    const { serverId, rows, characterId, param } = props;
    const detail = useValheimCharacterMaps(characterId);
    const maps = detail.data?.id === characterId ? detail.data.maps : [];
    const mapId = pickMapId(maps, param);
    return (
        <div className="grid gap-3">
            <CharacterMapBody
                serverId={serverId}
                characterId={characterId}
                mapId={mapId}
                detail={detail}
                pickers={
                    <Pickers rows={rows} characterId={characterId} maps={maps} mapId={mapId} />
                }
            />
        </div>
    );
}

/** The character list is in: pick the selected character (query, own, first). */
function ServerCharacters({
    serverId,
    rows,
    params,
}: {
    serverId: number;
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
            serverId={serverId}
            rows={rows}
            characterId={characterId}
            param={params.get(MAP_PARAM)}
        />
    );
}

/** ROK-1889: the chest focus card above the map; the marker reads the context. */
export function ValheimMapTab({ serverId }: ValheimMapTabProps) {
    const focus = useChestFocus(serverId);
    return (
        <ChestFocusContext.Provider value={focus.query.data ?? null}>
            <div className="grid gap-3">
                <ChestFocusCard target={focus.target} query={focus.query} />
                <MapTabBody serverId={serverId} />
            </div>
        </ChestFocusContext.Provider>
    );
}

function MapTabBody({ serverId }: ValheimMapTabProps) {
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
    return (
        <ServerCharacters
            serverId={serverId}
            rows={characters.data}
            params={params}
        />
    );
}

export default ValheimMapTab;
