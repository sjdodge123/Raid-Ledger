/**
 * ROK-2207 prototype — the group row: picked characters as removable chips and
 * the OQ4 "+ Add character" picker over this hub's guild roster (claimed
 * characters, anyone's; unclaimed rows greyed "no quest data"), max 5.
 * Uses the design-system `Combobox` (the autocomplete primitive).
 */
import { useState, type JSX } from 'react';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Combobox } from '../../components/ui/combobox';
import { RemovableChip } from '../../components/ui/removable-chip';
import { levelFit, type PlannerCharacter } from './planner-helpers';
import { MAX_CHARS, type PlannerState } from './use-planner-state';

function RosterOption({ c }: { c: PlannerCharacter }): JSX.Element {
    return (
        <span className={`flex w-full items-center justify-between gap-2 ${c.characterId ? 'text-foreground' : 'text-dim'}`}>
            <span className="truncate">{c.name} <span className="text-xs text-muted">{c.className} {c.level}</span></span>
            {!c.characterId && <span className="text-xs text-dim">no quest data</span>}
        </span>
    );
}

/** The roster picker: type to filter, pick to add; closes back to the button. */
function RosterPicker({ s, onDone }: { s: PlannerState; onDone: () => void }): JSX.Element {
    const [text, setText] = useState('');
    const options = s.available.filter((c) => c.name.toLowerCase().includes(text.trim().toLowerCase()));
    return (
        <div className="flex w-full max-w-xs items-center gap-2">
            <Combobox<PlannerCharacter> label="Add a character from the roster" options={options} value={null}
                getKey={(c) => c.name} getLabel={(c) => c.name} inputValue={text} onInputChange={setText}
                onChange={(c) => { if (c) { s.add(c.name); setText(''); onDone(); } }}
                renderOption={(c) => <RosterOption c={c} />} placeholder="Search the roster" fieldSize="sm"
                emptyText="No one left on the roster" openOnFocus autoFocus />
            <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        </div>
    );
}

/** Picked characters as chips (⚠ below range, "no quest data" when unclaimed) plus "+ Add character". */
export function GroupChips({ s, instance }: { s: PlannerState; instance: WowInstanceDto }): JSX.Element {
    const [picking, setPicking] = useState(false);
    const left = MAX_CHARS - s.chars.length;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Group ({s.chars.length}/{MAX_CHARS})</span>
            {s.chars.map((c) => (
                <RemovableChip key={c.name} label={c.name} removeLabel={`Remove ${c.name}`} onRemove={() => s.remove(c.name)}
                    detail={`${c.level}${levelFit(c.level, instance) === 'below' ? ' ⚠' : ''}${c.characterId ? '' : ' · no quest data'}`} />
            ))}
            {picking && s.canAdd && <RosterPicker s={s} onDone={() => setPicking(false)} />}
            {!picking && left > 0 && (
                <Button variant="secondary" size="sm" className="scroll-mb-24" onClick={() => setPicking(true)}>
                    + Add character ({left} left)
                </Button>
            )}
        </div>
    );
}
