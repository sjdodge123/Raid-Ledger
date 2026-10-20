/**
 * ROK-1870 — the game and user pickers the Admin → Hubs dialogs share. Both
 * are the shared `Combobox` over the existing search endpoints.
 */
import { useState, type JSX } from 'react';
import { Combobox } from '../../components/ui/combobox';
import { useGameSearch } from '../../hooks/use-game-search';
import { usePlayers } from '../../hooks/use-players';

export interface PickedOption {
    id: number;
    label: string;
}

interface PickerProps {
    label: string;
    value: PickedOption | null;
    onChange: (v: PickedOption | null) => void;
}

const key = (o: PickedOption): string => String(o.id);
const text = (o: PickedOption): string => o.label;

/** Search-as-you-type game picker. */
export function GamePicker({ label, value, onChange }: PickerProps): JSX.Element {
    const [q, setQ] = useState('');
    const search = useGameSearch(q);
    const options = (search.data?.data ?? []).map((g) => ({ id: g.id, label: g.name }));
    return (
        <Combobox label={label} options={options} getKey={key} getLabel={text} value={value} onChange={onChange}
            inputValue={q} onInputChange={setQ} loading={search.isFetching} placeholder="Search games"
            emptyText={q.length < 2 ? 'Type at least 2 characters' : 'No games found'} />
    );
}

/** Search-as-you-type member picker over the site's players. */
export function UserPicker({ label, value, onChange }: PickerProps): JSX.Element {
    const [q, setQ] = useState('');
    const players = usePlayers(1, q);
    const options = (players.data?.data ?? []).map((u) => ({ id: u.id, label: u.username }));
    return (
        <Combobox label={label} options={options} getKey={key} getLabel={text} value={value} onChange={onChange}
            inputValue={q} onInputChange={setQ} loading={players.isFetching} placeholder="Search members"
            emptyText="No members found" />
    );
}
