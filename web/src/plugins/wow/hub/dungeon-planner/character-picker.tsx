/**
 * ROK-2216 — the planner's group row (port of the ROK-2207 prototype's
 * `GroupChips`): picked characters as `RemovableChip`s in pick order and the
 * "+ Add character" roster `Combobox` (claimed characters carry quest data;
 * unclaimed rows are greyed "no quest data" but stay in the plan), max five.
 */
import { useState, type JSX } from 'react';
import { MAX_DUNGEON_PLAN_CHARACTERS } from '@raid-ledger/contract';
import { Button } from '../../../../components/ui/button';
import { Combobox } from '../../../../components/ui/combobox';
import { Field } from '../../../../components/ui/field';
import { RemovableChip } from '../../../../components/ui/removable-chip';
import type { RosterPick } from './planner-roster';
import type { PlannerState } from './use-planner-state';

/** The slice of planner state the group row reads and edits. */
export type GroupChipsState = Pick<PlannerState, 'picks' | 'available' | 'canAdd' | 'add' | 'remove'>;

interface GroupChipsProps {
    s: GroupChipsState;
    /** Pick keys whose level is below the dungeon's minimum (⚠ on the chip). */
    belowRange: ReadonlySet<string>;
    /** Pick keys the plan API dropped (stale claimed ids, spec L11). */
    dropped: ReadonlySet<string>;
}

/** "Lv20 ⚠ · no quest data" — level, below-range mark and why a pick carries no quests. */
function chipDetail(p: RosterPick, below: boolean, dropped: boolean): string {
    const level = p.level === null ? 'Lv?' : `Lv${p.level}`;
    const why = dropped ? ' · no longer on the roster' : p.claimed ? '' : ' · no quest data';
    return `${level}${below ? ' ⚠' : ''}${why}`;
}

function RosterOption({ p }: { p: RosterPick }): JSX.Element {
    return (
        <span className={`flex w-full items-center justify-between gap-2 ${p.claimed ? 'text-foreground' : 'text-dim'}`}>
            <span className="truncate">{p.name} <span className="text-xs text-muted">{p.className} {p.level ?? '?'}</span></span>
            {!p.claimed && <span className="text-xs text-dim">no quest data</span>}
        </span>
    );
}

/** The roster picker: type to filter, pick to add; closes back to the button. */
function RosterPicker({ s, onDone }: { s: GroupChipsState; onDone: () => void }): JSX.Element {
    const [text, setText] = useState('');
    const needle = text.trim().toLowerCase();
    const options = s.available.filter((p) => p.name.toLowerCase().includes(needle));
    return (
        <div className="flex w-full max-w-xs items-end gap-2">
            <Field label="Add a character from the roster" hideLabel className="min-w-0 flex-1">
                <Combobox<RosterPick> label="Add a character from the roster" options={options} value={null}
                    getKey={(p) => p.key} getLabel={(p) => p.name} inputValue={text} onInputChange={setText}
                    onChange={(p) => { if (p) { s.add(p.key); setText(''); onDone(); } }}
                    renderOption={(p) => <RosterOption p={p} />} placeholder="Search the roster" fieldSize="sm"
                    emptyText="No one left on the roster" openOnFocus autoFocus />
            </Field>
            <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        </div>
    );
}

/** Picked characters as chips plus "+ Add character", or the "group full" hint at five. */
export function GroupChips({ s, belowRange, dropped }: GroupChipsProps): JSX.Element {
    const [picking, setPicking] = useState(false);
    const max = MAX_DUNGEON_PLAN_CHARACTERS;
    const left = max - s.picks.length;
    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="planner-group">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Group ({s.picks.length}/{max})</span>
            {s.picks.map((p) => (
                <RemovableChip key={p.key} label={p.name} removeLabel={`Remove ${p.name}`} onRemove={() => s.remove(p.key)}
                    testId={`planner-chip-${p.key}`} detail={chipDetail(p, belowRange.has(p.key), dropped.has(p.key))} />
            ))}
            {picking && s.canAdd && <RosterPicker s={s} onDone={() => setPicking(false)} />}
            {!picking && s.canAdd && (
                <Button variant="secondary" size="sm" className="scroll-mb-24" onClick={() => setPicking(true)}>
                    + Add character ({left} left)
                </Button>
            )}
            {!s.canAdd && <p className="text-xs text-muted">Group full ({max}/{max}) — remove someone to add another.</p>}
        </div>
    );
}
