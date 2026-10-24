/**
 * ROK-1943 D13 "Whose pins" — a segmented This character / Everyone / Choose
 * players radio; Choose reveals a checkbox list of the server's characters.
 * "Choose" with nothing ticked is local state only: an empty pick is written
 * as absent (this character), so the URL never holds an empty list. D11: in a
 * players scope a muted hint says cartography copies are left out.
 */
import { useState, type JSX } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { RadioGroup, type RadioOption } from '../../../components/ui/radio-group';
import { Checkbox } from '../../../components/ui/checkbox';
import { useValheimServerCharacters } from '../hooks/use-valheim-map-characters';
import { sortByName } from './map-selection';
import type { PinFilter, PinPlayers } from './pin-filter';

type PlayersMode = 'character' | 'all' | 'choose';

const MODES: readonly RadioOption<PlayersMode>[] = [
    { value: 'character', label: 'This character' },
    { value: 'all', label: 'Everyone' },
    { value: 'choose', label: 'Choose players' },
];

export const CARTOGRAPHY_HINT = "Cartography-table copies are left out — each player's own pins show.";

export interface PinFilterPlayersProps {
    players: PinPlayers;
    serverId: number;
    onChange: (patch: Partial<PinFilter>) => void;
}

function pickedOf(players: PinPlayers): readonly number[] {
    return typeof players === 'string' ? [] : players;
}

/** Toggle one id in the pick; an empty pick is "this character" (written as absent). */
function nextPick(picked: readonly number[], id: number, on: boolean): PinPlayers {
    const next = on ? [...picked, id] : picked.filter((p) => p !== id);
    return next.length > 0 ? next : 'character';
}

function PlayerList({ picked, serverId, onPick }: {
    picked: readonly number[]; serverId: number; onPick: (id: number, on: boolean) => void;
}): JSX.Element {
    const rows = useValheimServerCharacters(serverId);
    if (rows.isPending) return <p className="text-sm text-muted">Loading players…</p>;
    if (rows.isError) return <p className="text-sm text-muted">Players could not be loaded.</p>;
    const sorted: ValheimCharacterSummary[] = sortByName(rows.data);
    return (
        <div className="grid max-h-64 gap-1 overflow-y-auto" data-testid="map-pin-filter-player-list">
            {sorted.map((c) => (
                <Checkbox key={c.id} label={c.name} checked={picked.includes(c.id)}
                    onChange={(e) => onPick(c.id, e.target.checked)} />
            ))}
        </div>
    );
}

/** The "Whose pins" section — render only when the view has a `serverId`. */
export function PinFilterPlayers({ players, serverId, onChange }: PinFilterPlayersProps): JSX.Element {
    const [choosing, setChoosing] = useState(typeof players !== 'string');
    const mode: PlayersMode = typeof players !== 'string' || choosing ? 'choose' : players;
    const onMode = (next: PlayersMode): void => {
        setChoosing(next === 'choose');
        onChange({ players: next === 'choose' ? 'character' : next });
    };
    const picked = pickedOf(players);
    return (
        <div className="grid gap-2">
            <RadioGroup label="Whose pins" appearance="segmented" className="flex-wrap" options={MODES} value={mode}
                onChange={onMode} />
            {mode === 'choose' && (
                <PlayerList picked={picked} serverId={serverId}
                    onPick={(id, on) => onChange({ players: nextPick(picked, id, on) })} />
            )}
            {players !== 'character' && <p className="text-xs text-muted">{CARTOGRAPHY_HINT}</p>}
        </div>
    );
}
