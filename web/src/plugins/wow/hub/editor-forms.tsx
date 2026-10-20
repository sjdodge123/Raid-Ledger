/**
 * ROK-1785 — the "add an editor" picker from the prototype's `EditorsPanel.tsx`:
 * one chosen member. Already-granted members drop out of it. ROK-1794
 * "explicit grants only": the whole-rank picker is gone — a rank grant confers
 * nothing, so existing ones show as inactive and new ones are not offered.
 */
import { useState, type JSX } from 'react';
import type { CreateGuildEditorInput, GuildEditor, GuildPage } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { delegableMembers, rankLabel } from './wow-guild.helpers';

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
