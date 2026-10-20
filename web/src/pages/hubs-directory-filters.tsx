/**
 * ROK-1870 — the `/hubs` funnel body (design-system §4.1): Game (`Combobox`
 * over the game search), Membership (`RadioGroup`) and Sort (`Select`), behind
 * the shared `FilterEntry` (inline panel >=1024px, FAB + BottomSheet below).
 */
import { useState, type JSX } from 'react';
import { Combobox } from '../components/ui/combobox';
import { FilterEntry } from '../components/ui/filter-entry';
import { RadioGroup } from '../components/ui/radio-group';
import { Select } from '../components/ui/select';
import { Field } from '../components/ui/field';
import { useGameSearch } from '../hooks/use-game-search';
import {
    directoryActiveCount, type HubMembershipFilter, type HubSort, type HubsDirectoryParams,
} from './use-hubs-directory';

interface GameOption { id: number; name: string }

const MEMBERSHIP_OPTIONS = [
    { value: 'all', label: 'All' }, { value: 'joined', label: 'Joined' }, { value: 'not-joined', label: 'Not joined' },
] satisfies { value: HubMembershipFilter; label: string }[];
const SORT_OPTIONS = [
    { value: 'members', label: 'Most members' }, { value: 'name', label: 'Name' }, { value: 'newest', label: 'Newest' },
] satisfies { value: HubSort; label: string }[];

export interface HubsDirectoryFiltersProps {
    params: HubsDirectoryParams;
    onChange: (next: HubsDirectoryParams) => void;
    /** Display name for `params.gameId` when known from the loaded cards. */
    gameName?: string | undefined;
}

function GameFilter({ params, onChange, gameName }: HubsDirectoryFiltersProps): JSX.Element {
    // null = untouched: the box shows the URL's game (?game=N) instead of an empty field.
    const [text, setText] = useState<string | null>(null);
    // Codex r3: "Clear all" (or any outside change) resets the draft so the box shows the real filter.
    const [syncedGameId, setSyncedGameId] = useState(params.gameId);
    if (syncedGameId !== params.gameId) {
        setSyncedGameId(params.gameId);
        setText(null);
    }
    const search = useGameSearch(text ?? '');
    const options: GameOption[] = (search.data?.data ?? []).map((g) => ({ id: g.id, name: g.name }));
    const value: GameOption | null = params.gameId ? { id: params.gameId, name: gameName ?? `Game ${params.gameId}` } : null;
    return (
        <Combobox<GameOption> label="Game" options={options} value={value} getKey={(g) => String(g.id)} getLabel={(g) => g.name}
            inputValue={text ?? value?.name ?? ''} onInputChange={setText} loading={search.isFetching} emptyText="Type to search games"
            onChange={(g) => onChange({ ...params, gameId: g?.id })} />
    );
}

function SortFilter({ params, onChange }: HubsDirectoryFiltersProps): JSX.Element {
    const pick = (v: string): void => {
        const sort = SORT_OPTIONS.find((o) => o.value === v)?.value ?? 'members';
        onChange({ ...params, sort });
    };
    return (
        <Field label="Sort">
            <Select value={params.sort} onChange={(e) => pick(e.target.value)}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
        </Field>
    );
}

/** The funnel + its body; the toolbar trigger lives in the page. */
export function HubsDirectoryFilters(props: HubsDirectoryFiltersProps & { isOpen: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
    const { params, onChange, isOpen, onOpenChange } = props;
    return (
        <FilterEntry activeCount={directoryActiveCount(params)} isOpen={isOpen} onOpenChange={onOpenChange}
            onClearAll={() => onChange({ ...params, gameId: undefined, membership: 'all' })}>
            <div className="grid gap-4 lg:grid-cols-3">
                <GameFilter {...props} />
                <RadioGroup<HubMembershipFilter> label="Membership" options={MEMBERSHIP_OPTIONS} value={params.membership}
                    onChange={(membership) => onChange({ ...params, membership })} />
                <SortFilter {...props} />
            </div>
        </FilterEntry>
    );
}
