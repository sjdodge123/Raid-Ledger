/**
 * Role dropdown for player filters (ROK-821).
 * Options: All / Member / Operator / Admin.
 */
import type { JSX } from 'react';

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
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Role</span>
            <select
                aria-label="Role"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
                {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </label>
    );
}
