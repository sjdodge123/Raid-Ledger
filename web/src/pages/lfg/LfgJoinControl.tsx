/**
 * ROK-1479 — the group page's `+1 · I'm in` asks WHEN, like everywhere else.
 *
 * Before this, `/lfg/:gameSlug` was the one hand-raise surface that could only
 * post a WEEKLY intent: a viewer who arrived from a `🔥 2 want to play now`
 * chip could read the now strip but had no way to join it as `now`. The button
 * therefore opens {@link LfgUrgencyChoice} — the same control, the same three
 * labels and the same testids the hearted prompt uses — and the join fires on
 * the pick rather than on the button.
 *
 * The button TOGGLES the panel: opening a choice by accident with no way back
 * is the complaint the prompt's version earned, so re-clicking closes it and
 * nothing is posted.
 *
 * `Withdraw` is deliberately untouched — there is only one way to leave.
 */
import { useState, type JSX } from 'react';
import {
    LfgUrgencyChoice,
    type LfgUrgencyPick,
} from '../../components/lfg/lfg-urgency-choice';
import { LFG_COPY } from './lfg-copy';

export interface LfgJoinControlProps {
    /** What is being joined (the game's name) — names the choice group. */
    label: string;
    /** Receives the pick, ready to spread into the join mutation (A2). */
    onJoin: (pick: LfgUrgencyPick) => void;
    /** The caller's button styling, so the bar keeps one button vocabulary. */
    className: string;
    /** Disables the button and the three choices while a write is in flight. */
    isBusy?: boolean;
}

/**
 * `+1 · I'm in`, plus the urgency choice it opens.
 *
 * @param props.label - The game's name, for the choice group's accessible name.
 * @param props.onJoin - Called once, with the pick, on the second click.
 * @param props.className - Button classes supplied by the calling surface.
 * @param props.isBusy - True while a join or withdraw is in flight.
 */
export function LfgJoinControl({
    label,
    onJoin,
    className,
    isBusy,
}: LfgJoinControlProps): JSX.Element {
    const [choosing, setChoosing] = useState(false);
    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                data-testid="lfg-join-button"
                className={className}
                disabled={isBusy}
                aria-expanded={choosing}
                onClick={() => setChoosing((open) => !open)}
            >
                {LFG_COPY.join}
            </button>
            {choosing ? (
                <LfgUrgencyChoice
                    label={label}
                    disabled={isBusy}
                    onPick={(pick) => {
                        setChoosing(false);
                        onJoin(pick);
                    }}
                />
            ) : null}
        </div>
    );
}
