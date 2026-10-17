/**
 * ROK-1785 — role badge + role summary, copied from the prototype's
 * `role-bits.tsx`. Colours come from the existing `.role-tank` /
 * `.role-healer` / `.role-dps` classes (`web/src/index.css`) — border and
 * icon tint only; labels stay `text-foreground` so they read in light themes.
 */
import type { JSX } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
import { RoleIcon } from '../../../components/shared/RoleIcon';
import { ROLE_META, ROLE_ORDER } from './wow-guild.helpers';

/** Read-only role pill: role-coloured border + the shared role icon + a neutral label. */
export function CharRoleBadge({ role }: { role: CharacterRole }): JSX.Element {
    const meta = ROLE_META[role];
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border bg-panel px-1.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
            <RoleIcon role={role} size="h-3.5 w-3.5" />
            <span className="text-foreground">{meta.label}</span>
        </span>
    );
}

/** "2 Tank · 4 Heal · 12 DPS" as three role pills. */
export function RoleSummary({ counts }: { counts: Record<CharacterRole, number> }): JSX.Element {
    return (
        <ul aria-label="Members by role" className="flex flex-wrap gap-2">
            {ROLE_ORDER.map((role) => (
                <li key={role} data-testid={`guild-role-count-${role}`}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border bg-panel px-2.5 ${ROLE_META[role].cls}`}>
                    <RoleIcon role={role} size="h-4 w-4" />
                    <span className="text-sm font-semibold text-foreground">{counts[role]}</span>
                    <span className="text-sm text-secondary">{ROLE_META[role].label}</span>
                </li>
            ))}
        </ul>
    );
}
