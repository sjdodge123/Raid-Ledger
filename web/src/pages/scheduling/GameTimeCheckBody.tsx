/**
 * The game-time check — ONE question with FOUR answers (ROK-1564).
 *
 * Spike §d ("Two steps, not one grid") replaced the week painter that used to
 * live inside the poll overlay with a single question. The four answers are the
 * only ways out, and none of them renders the week editor in the overlay:
 *   1. "Looks right"        → confirm-only save (stamps game_time_confirmed_at)
 *   2. "I'm away some days" → reveals the shared <AwayPanel layout="stacked"/> inline
 *      (ROK-1585: the modal is ~448px, too narrow for the D1 one-line add)
 *   3. "Edit my week"       → a Link OUT to the profile editor, carrying ?return=
 *   4. "Skip"               → the caller's session-skip, unchanged
 *
 * Wireframe: `web/src/dev/scheduling-wireframes/OptionACompPanel.tsx` (panel C
 * of `/dev/wireframes/scheduling`, the Option A comp). ROK-1569 replaced this
 * body on PHONES with the week editor itself (`PhoneWeekCheckStep`); these four
 * answers are the DESKTOP modal's step 1 and are unchanged.
 * No new pattern: the answers use the established secondary-button recipe
 * (`border-edge-strong` outline on `bg-surface` with a `hover:bg-panel` token
 * hover, see `SelectableCharacterCard`) and the emerald primary recipe this
 * overlay's own Save button already used. Every colour is a token or a hue with
 * a light-family override in `index.css`; nothing is hardcoded.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { AwayPanel } from '../../components/features/game-time/away/AwayPanel';
import {
    ANSWER_PRIMARY,
    ANSWER_SECONDARY,
    gameTimeCheckPrompt,
} from '../../components/features/game-time/game-time-check-copy';
import { useConfirmGameTime } from '../../hooks/use-game-time';

const GAME_TIME_ROUTE = '/profile/gaming/game-time';

/** Answer 1 — confirm-only save; the shell closes when staleness clears. */
function ConfirmAnswer(): JSX.Element {
    const confirm = useConfirmGameTime();
    return (
        <button
            type="button"
            data-testid="game-time-check-confirm"
            className={ANSWER_PRIMARY}
            disabled={confirm.isPending}
            onClick={() =>
                confirm.mutate(undefined, {
                    onError: () => toast.error('Could not confirm your game time'),
                })
            }
        >
            {confirm.isPending ? 'Confirming…' : 'Looks right'}
        </button>
    );
}

/** Answer 2 — reveals the stacked away panel inline (never the painter). */
function AbsenceAnswer(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                data-testid="game-time-check-absence"
                aria-expanded={open}
                className={ANSWER_SECONDARY}
                onClick={() => setOpen((v) => !v)}
            >
                I&apos;m away some days
            </button>
            {open && (
                <div data-testid="game-time-check-absence-panel" className="rounded-lg border border-edge bg-panel/40 p-3">
                    <AwayPanel layout="stacked" />
                </div>
            )}
        </>
    );
}

/** Answer 3 — leaves the overlay for the profile editor, carrying ?return=. */
function EditWeekAnswer(): JSX.Element {
    const location = useLocation();
    const returnTo = `${location.pathname}${location.search}`;
    return (
        <Link
            data-testid="game-time-check-edit"
            to={`${GAME_TIME_ROUTE}?return=${encodeURIComponent(returnTo)}`}
            className={`${ANSWER_SECONDARY} block`}
        >
            Edit my week →
        </Link>
    );
}

export interface GameTimeCheckBodyProps {
    /** Whole days since the last confirmation; `null` = never confirmed. */
    ageDays: number | null | undefined;
    /** Whether the viewer has any saved template slots (drives the null-age copy). */
    hasSlots: boolean;
    /** Which shell rendered us — `modal` ≥768px, `sheet` below. */
    surface: 'modal' | 'sheet';
    /** Answer 4 — the caller's session-skip + dismiss. */
    onSkip: () => void;
}

/** The check's body; identical in the Modal and the BottomSheet. */
export function GameTimeCheckBody({ ageDays, hasSlots, surface, onSkip }: GameTimeCheckBodyProps): JSX.Element {
    return (
        <div data-testid="game-time-check-body" data-surface={surface} className="flex flex-col gap-3">
            <p data-testid="game-time-check-prompt" className="text-sm text-foreground">
                {gameTimeCheckPrompt(ageDays, hasSlots)}
            </p>
            <div className="flex flex-col gap-2">
                <ConfirmAnswer />
                <AbsenceAnswer />
                <EditWeekAnswer />
            </div>
            <button
                type="button"
                data-testid="game-time-check-skip"
                onClick={onSkip}
                className="min-h-[44px] px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
                Skip
            </button>
        </div>
    );
}
