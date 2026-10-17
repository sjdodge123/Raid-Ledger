/**
 * Role dropdown for player filters (ROK-821; ROK-1651 moved it onto Field + Select).
 * Options: All / Member / Operator / Admin.
 */
import type { JSX } from 'react';
import { Field } from '../../ui/field';
import { Select } from '../../ui/select';

const ROLE_OPTIONS = [
    { value: '', label: 'All' },
    { value: 'member', label: 'Member' },
    { value: 'operator', label: 'Operator' },
    { value: 'admin', label: 'Admin' },
] as const;

interface RoleSelectProps {
    value: string;
    onChange: (value: string) => void;
}

/** Role filter dropdown. */
export function RoleSelect({ value, onChange }: RoleSelectProps): JSX.Element {
    return (
        <Field label="Role">
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </Select>
        </Field>
    );
}
