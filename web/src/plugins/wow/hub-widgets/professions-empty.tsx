/**
 * ROK-1923 — the Guild professions empty state: nobody has set professions.
 * Links the viewer to their own WoW: Forever character (main first), whose
 * page shows an owner the "Add Professions" panel; otherwise a plain hint.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useMyCharacters } from '../../../hooks/use-characters';
import { FOCUS_RING } from '../../../components/ui/form-classes';

/** Empty state for the professions widget; `gameId` is the hub's (Forever) game. */
export function ProfessionsEmpty({ gameId }: { gameId: number }): JSX.Element {
    const { data } = useMyCharacters(gameId);
    const chars = data?.data ?? [];
    const own = chars.find((c) => c.isMain) ?? chars[0];
    return (
        <div className="flex flex-col items-start gap-2 text-sm text-muted">
            <p>No one has set their professions yet.</p>
            {own ? (
                <Link to={`/characters/${own.id}`}
                    className={`rounded-sm font-medium text-foreground underline underline-offset-2 hover:opacity-80 ${FOCUS_RING}`}>
                    Set your professions
                </Link>
            ) : (
                <p>Members can add them from their character page once they have a WoW: Forever character.</p>
            )}
        </div>
    );
}
