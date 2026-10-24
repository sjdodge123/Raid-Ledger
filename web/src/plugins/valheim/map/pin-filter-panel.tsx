/**
 * ROK-1943 D13 — the Map pin filter body inside the §4.1 `FilterEntry`
 * (inline panel ≥1024px, Filters FAB + BottomSheet below). Top → bottom: Pin
 * types (`FilterChip`s, Q2 fixed order), Whose pins (only with a `serverId`),
 * Search labels (debounced → `q`), Hide crossed-out pins (`Checkbox`, §4.11).
 */
import { useState, type JSX, type ReactNode } from 'react';
import { FilterEntry } from '../../../components/ui/filter-entry';
import { FilterChip } from '../../../components/ui/filter-chip';
import { SearchInput } from '../../../components/ui/search-input';
import { Checkbox } from '../../../components/ui/checkbox';
import { Button } from '../../../components/ui/button';
import { PIN_QUERY_MAX, type PinFilter } from './pin-filter';
import { PIN_TYPE_GROUPS } from './pin-type-groups';
import { PinFilterPlayers } from './pin-filter-players';
import type { PinFilterPanelState } from './use-pin-filter';

export interface PinFilterPanelProps {
    panel: PinFilterPanelState;
    /** Needed for the "Whose pins" list; the section also needs `panel.playersAvailable`. */
    serverId?: number | undefined;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** Bumped by the owner on every clear so local inputs (search text, Choose) reset. */
    resetKey: number;
    onClearAll: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return (
        <section className="grid gap-2" aria-label={title}>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {children}
        </section>
    );
}

function TypeChips({ filter, onToggle, onAll }: {
    filter: PinFilter; onToggle: PinFilterPanelState['onToggleType']; onAll: () => void;
}): JSX.Element {
    return (
        <Section title="Pin types">
            <div className="flex flex-wrap gap-2" data-testid="map-pin-filter-types">
                {PIN_TYPE_GROUPS.map((g) => (
                    <FilterChip key={g.id} label={g.label} icon={g.Icon} testId={`map-pin-type-${g.id}`}
                        pressed={filter.types?.has(g.id) === true} onPressedChange={() => onToggle(g.id)} />
                ))}
            </div>
            <Button variant="ghost" size="md" className="justify-self-start" disabled={filter.types === null}
                onClick={onAll}>
                All types
            </Button>
        </Section>
    );
}

function LabelSearch({ query, onChange }: { query: string; onChange: PinFilterPanelState['onChange'] }): JSX.Element {
    const [text, setText] = useState(query);
    return (
        <Section title="Search labels">
            <SearchInput value={text} onChange={setText} label="Search pin labels" maxLength={PIN_QUERY_MAX}
                placeholder="Pin label" onSearch={(q) => onChange({ query: q })}
                onClear={() => onChange({ query: '' })} />
        </Section>
    );
}

/**
 * The box holds the click locally: the router commits the URL write in a
 * transition, so a box bound straight to `checked` would snap back unchecked
 * until it lands. A new `checked` (the write, a clear, a reload) wins.
 */
function HideCrossed({ checked, onChange }: { checked: boolean; onChange: PinFilterPanelState['onChange'] }): JSX.Element {
    const [shown, setShown] = useState(checked);
    const [synced, setSynced] = useState(checked);
    if (synced !== checked) {
        setSynced(checked);
        setShown(checked);
    }
    return (
        <Checkbox label="Hide crossed-out pins" checked={shown}
            onChange={(e) => {
                setShown(e.target.checked);
                onChange({ hideCrossed: e.target.checked });
            }} />
    );
}

/** The four filter sections in the shared filter entry. */
export function PinFilterPanel({ panel, serverId, isOpen, onOpenChange, resetKey, onClearAll }: PinFilterPanelProps): JSX.Element {
    const { filter, onChange } = panel;
    return (
        <FilterEntry activeCount={panel.activeCount} isOpen={isOpen} onOpenChange={onOpenChange} onClearAll={onClearAll}>
            <div className="grid gap-4" data-testid="map-pin-filter-panel">
                <TypeChips filter={filter} onToggle={panel.onToggleType} onAll={() => onChange({ types: null })} />
                {panel.playersAvailable && serverId !== undefined && (
                    <PinFilterPlayers key={`players-${resetKey}`} players={filter.players} serverId={serverId} onChange={onChange} />
                )}
                <LabelSearch key={`search-${resetKey}`} query={filter.query} onChange={onChange} />
                <HideCrossed checked={filter.hideCrossed} onChange={onChange} />
            </div>
        </FilterEntry>
    );
}
