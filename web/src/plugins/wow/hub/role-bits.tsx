/**
 * ROK-1785 — role badge + role summary, copied from the prototype's
 * `role-bits.tsx`. Colours come from the existing `.role-tank` /
 * `.role-healer` / `.role-dps` classes (`web/src/index.css`) — border and
 * icon tint only; labels stay `text-foreground` so they read in light themes.
 */
import type { JSX } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
import { RoleIcon } from '../../../components/shared/RoleIcon';
import { FOCUS_RING } from '../../../components/ui/form-classes';
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

const PILL = 'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5';
/** §4.3 toggle fills (`FilterChip` OFF / ON); the border stays the role colour. */
const PILL_OFF = 'bg-panel hover:bg-overlay';
const PILL_ON = 'bg-amber-500/10 hover:bg-amber-500/20';

export interface RoleSummaryProps {
    counts: Record<CharacterRole, number>;
    /** ROK-2172 Overview: each pill is a plain `<a>` to this href (so `useHashTab` sees the hashchange). */
    hrefFor?: (role: CharacterRole) => string;
    /** ROK-2172 Members band: each pill is an `aria-pressed` toggle, pressed while its role is in `selected`. */
    onToggle?: (role: CharacterRole) => void;
    selected?: readonly string[];
}

function PillBody({ role, count }: { role: CharacterRole; count: number }): JSX.Element {
    return (
        <>
            <RoleIcon role={role} size="h-4 w-4" />
            <span className="text-sm font-semibold text-foreground">{count}</span>
            <span className="text-sm text-secondary">{ROLE_META[role].label}</span>
        </>
    );
}

function RolePill({ role, count, hrefFor, onToggle, selected }: Omit<RoleSummaryProps, 'counts'> & { role: CharacterRole; count: number }): JSX.Element {
    const name = `Show ${count} ${ROLE_META[role].label} members`;
    const base = `${PILL} ${ROLE_META[role].cls} transition-colors ${FOCUS_RING}`;
    if (onToggle) {
        const pressed = selected?.includes(role) ?? false;
        return (
            <button type="button" aria-pressed={pressed} aria-label={name} data-testid={`guild-role-filter-${role}`}
                onClick={() => onToggle(role)} className={`${base} ${pressed ? PILL_ON : PILL_OFF}`}>
                <PillBody role={role} count={count} />
            </button>
        );
    }
    if (hrefFor) {
        return (
            <a href={hrefFor(role)} aria-label={name} data-testid={`guild-role-filter-${role}`} className={`${base} ${PILL_OFF}`}>
                <PillBody role={role} count={count} />
            </a>
        );
    }
    return <span className={`${PILL} bg-panel ${ROLE_META[role].cls}`}><PillBody role={role} count={count} /></span>;
}

/**
 * "2 Tank · 4 Heal · 12 DPS" as three role pills. Read-only by default;
 * `hrefFor` makes them links, `onToggle` makes them filter toggles (ROK-2172).
 */
export function RoleSummary({ counts, ...mode }: RoleSummaryProps): JSX.Element {
    return (
        <ul aria-label="Members by role" className="flex flex-wrap gap-2">
            {ROLE_ORDER.map((role) => (
                <li key={role} data-testid={`guild-role-count-${role}`} className="inline-flex">
                    <RolePill role={role} count={counts[role]} {...mode} />
                </li>
            ))}
        </ul>
    );
}
