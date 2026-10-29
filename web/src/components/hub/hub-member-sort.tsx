/**
 * ROK-1173 — the Members "Sort by" control. It sits in the toolbar at every
 * width (Q5), so a phone user sorts without opening the filter sheet. The
 * shared native `Select` (§3.1), small size, named by `aria-label` (the visible
 * "Sort by" text is decorative, so the name never picks up the selected option).
 */
import type { JSX } from 'react';
import type { HubMemberSort } from '../../plugins/hub-module';
import { Select } from '../ui/select';

interface Props {
    sorts: readonly HubMemberSort[];
    value: string;
    onChange: (id: string) => void;
}

export function MemberSortSelect({ sorts, value, onChange }: Props): JSX.Element {
    return (
        <div className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden="true" className="whitespace-nowrap">Sort by</span>
            <Select fieldSize="sm" aria-label="Sort by" value={value} onChange={(e) => onChange(e.target.value)}
                wrapperClassName="w-44" data-testid="guild-members-sort">
                {sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
        </div>
    );
}
