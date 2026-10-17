/**
 * ROK-1785 (spec D9) — a roster name as a link to `/characters/:id`. A guild
 * member with no Raid Ledger character renders as plain text, not a link.
 * Hover styling follows `components/profile/CharacterCard.tsx`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { FOCUS_RING } from '../../../components/ui/form-classes';

interface CharacterLinkProps {
    name: string;
    characterId: string | null;
    className?: string;
}

export function CharacterLink({ name, characterId, className = 'font-medium text-foreground' }: CharacterLinkProps): JSX.Element {
    if (characterId === null) return <span className={className} data-testid="guild-member-unlinked">{name}</span>;
    return (
        <Link to={`/characters/${characterId}`} data-testid="guild-member-link"
            className={`${className} rounded-sm underline-offset-2 transition-opacity hover:underline hover:opacity-80 ${FOCUS_RING}`}>
            {name}
        </Link>
    );
}
