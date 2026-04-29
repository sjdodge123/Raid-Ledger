/**
 * AbortLineupButton (ROK-1062).
 * Renders a destructive "Abort Lineup" trigger only for admin/operator
 * users on a non-archived lineup. Clicking opens AbortLineupModal.
 */
import { useState, type JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { AbortLineupModal } from './AbortLineupModal';

interface Props {
    lineup: LineupDetailResponseDto;
}

export function AbortLineupButton({ lineup }: Props): JSX.Element | null {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);

    if (!isOperatorOrAdmin(user) || lineup.status === 'archived') {
        return null;
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200 px-2.5 py-1.5 rounded border border-rose-500/40 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors flex-shrink-0 whitespace-nowrap min-h-[32px]"
                aria-label="Abort Lineup"
            >
                <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                    />
                </svg>
                <span className="hidden sm:inline">Abort Lineup</span>
            </button>
            {open && (
                <AbortLineupModal
                    lineupId={lineup.id}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
