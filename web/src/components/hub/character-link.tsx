/**
 * ROK-1785 (spec D9) — a roster name as a link to `/characters/:id`. A guild
 * member with no Raid Ledger character renders as plain text, not a link —
 * unless the caller passes `unlinkedTo` (ROK-2149: a plugin's roster-member
 * page), which keeps core game-agnostic. Hover styling follows
 * `components/profile/CharacterCard.tsx`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { FOCUS_RING } from '../ui/form-classes';

interface CharacterLinkProps {
    name: string;
    characterId: string | null;
    className?: string;
    /** ROK-2149 — where an unlinked name goes (the caller builds the path); omitted = plain text. */
    unlinkedTo?: string | undefined;
    /**
     * ROK-2155 — stretch the link over the nearest `relative` ancestor (a
     * Members row) with an `::after` overlay, so the whole row opens it while
     * staying ONE link (design-system §4.18). Only a shell that made the row
     * `relative` may pass it.
     */
    stretched?: boolean;
}

/** The StretchedAction overlay as a link's own `::after` — one link per row, no duplicate anchor. */
export const STRETCHED_LINK = 'after:absolute after:inset-0';

function linkClass(className: string, stretched: boolean): string {
    const base = `${className} rounded-sm underline-offset-2 transition-opacity hover:underline hover:opacity-80 ${FOCUS_RING}`;
    return stretched ? `${base} ${STRETCHED_LINK}` : base;
}

export function CharacterLink({ name, characterId, className = 'font-medium text-foreground', unlinkedTo, stretched = false }: CharacterLinkProps): JSX.Element {
    if (characterId === null) {
        if (unlinkedTo === undefined) return <span className={className} data-testid="guild-member-unlinked">{name}</span>;
        return <Link to={unlinkedTo} data-testid="guild-member-roster-link" className={linkClass(className, stretched)}>{name}</Link>;
    }
    return <Link to={`/characters/${characterId}`} data-testid="guild-member-link" className={linkClass(className, stretched)}>{name}</Link>;
}
