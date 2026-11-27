/** ROK-2352 §3.3 — the 1–3 role pick on a WoW hand (toggle chips, §4.3). */
import type { JSX } from 'react';
import type { WowLfgRole } from '@raid-ledger/contract';
import { FilterChip } from '../../../components/ui/filter-chip';
import { WOW_LFG_COPY } from './wow-lfg-copy';

const ROLE_OPTIONS: readonly { role: WowLfgRole; label: string }[] = [
    { role: 'tank', label: 'Tank' },
    { role: 'healer', label: 'Healer' },
    { role: 'dps', label: 'DPS' },
];

/** Toggle chips for tank / healer / dps; the hint shows while none is on. */
export function WowLfgRolePicker({ roles, onChange }: {
    roles: readonly WowLfgRole[]; onChange: (roles: WowLfgRole[]) => void;
}): JSX.Element {
    const toggle = (role: WowLfgRole, on: boolean): void =>
        onChange(on ? ROLE_OPTIONS.map((o) => o.role).filter((r) => r === role || roles.includes(r)) : roles.filter((r) => r !== role));
    return (
        <fieldset data-testid="wow-lfg-roles" className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{WOW_LFG_COPY.rolesLegend}</legend>
            <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map(({ role, label }) => (
                    <FilterChip key={role} label={label} pressed={roles.includes(role)} testId={`wow-lfg-role-${role}`}
                        onPressedChange={(on) => toggle(role, on)} />
                ))}
            </div>
            {roles.length === 0 && <p className="text-xs text-warning">{WOW_LFG_COPY.rolesRequired}</p>}
        </fieldset>
    );
}
