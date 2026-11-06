/** ROK-1836 L4 (D10) — member search for the admin owner picker; the shared `MemberCombobox` since ROK-2095. */
import type { JSX } from 'react';
import { MemberCombobox, type MemberOption } from '../../../components/shared/member-combobox';

export type OwnerOption = MemberOption;

interface OwnerSearchProps {
    value: OwnerOption | null;
    onChange: (option: OwnerOption | null) => void;
}

export function OwnerSearch({ value, onChange }: OwnerSearchProps): JSX.Element {
    return <MemberCombobox label="Find a member" value={value} onChange={onChange} />;
}
