/**
 * ROK-1870 — the game picker the Admin → Hubs create dialog uses: the shared
 * `Combobox` over the game search. Members are picked with the shared
 * `MemberCombobox` (ROK-2095). Wrap either in a `Field` — `label` here is only
 * an `aria-label` and is never drawn.
 */
import { useState, type JSX } from 'react';
import { Combobox } from '../../components/ui/combobox';
import { useGameSearch } from '../../hooks/use-game-search';

export interface PickedOption {
    id: number;
    label: string;
}

interface PickerProps {
    /** Accessible name only — omit inside a `Field`. */
    label?: string;
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
