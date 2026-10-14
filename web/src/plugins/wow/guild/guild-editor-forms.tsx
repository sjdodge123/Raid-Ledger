/**
 * ROK-1785 — the two "add an editor" pickers from the prototype's
 * `EditorsPanel.tsx`: a whole rank, or one chosen member. Already-granted
 * ranks and members drop out of their picker.
 */
import { useState, type JSX } from 'react';
import type { CreateGuildEditorInput, GuildEditor, GuildPage } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { delegableMembers, delegableRanks, rankLabel } from './guild-roster.helpers';

interface PickerProps {
    page: GuildPage;
    editors: readonly GuildEditor[];
    pending: boolean;
    onAdd: (input: CreateGuildEditorInput) => void;
}

interface PickerRowProps {
    label: string;
    testId: string;
    options: { value: string; label: string }[];
    pending: boolean;
    onPick: (value: string) => void;
}

function PickerRow({ label, testId, options, pending, onPick }: PickerRowProps): JSX.Element {
    const [pick, setPick] = useState('');
    const add = (): void => { if (pick) { onPick(pick); setPick(''); } };
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label={label} className="flex-1">
                <Select data-testid={testId} value={pick} placeholder="Pick one…" onChange={(e) => setPick(e.target.value)}>
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
            </Field>
            <Button variant="secondary" onClick={add} disabled={!pick || pending}>Add editor</Button>
        </div>
    );
}

export function AddRankEditor({ page, editors, pending, onAdd }: PickerProps): JSX.Element {
    const granted = new Set(editors.map((e) => e.rankIndex));
    const options = delegableRanks(page)
        .filter((r) => !granted.has(r.rankIndex))
        .map((r) => ({ value: String(r.rankIndex), label: r.name }));
    return (
        <PickerRow label="Whole rank" testId="guild-editor-rank-select" options={options} pending={pending}
            onPick={(v) => onAdd({ kind: 'rank', rankIndex: Number(v) })} />
    );
}

export function AddMemberEditor({ page, editors, pending, onAdd }: PickerProps): JSX.Element {
    const granted = new Set(editors.map((e) => e.guildMemberId));
    const options = delegableMembers(page)
        .filter((m) => !granted.has(m.memberId))
        .map((m) => ({ value: String(m.memberId), label: `${m.name} — ${rankLabel(m)}` }));
    return (
        <PickerRow label="Chosen member" testId="guild-editor-member-select" options={options} pending={pending}
            onPick={(v) => onAdd({ kind: 'member', guildMemberId: Number(v) })} />
    );
}
