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
    /**
     * ROK-1619 AC7: `pressWouldSpawnNow` from the group read — would THIS
     * viewer's `Right now` pick form the group? Marks the `+1` opener with the
     * glyph, as the board card's `+1` and the invite DM's `Join` carry it, and
     * the `Right now` pick with the glyph AND the words: on the web only that
     * pick forms the group, so "starts the group" stays on it (AC6).
     */
    spawnsNow?: boolean;
    /**
     * The server-resolved indicator glyph (`spawnIndicatorEmoji`). The server
     * always sends it with the flag (🎉 by default), so the web has no default.
     */
    spawnEmoji?: string;
}

/**
 * The `+1` opener: toggles the urgency choice. When `spawnGlyph` is set it
 * leads with the indicator, matching the Discord `+1`/`Join` buttons for the
 * same setting (ROK-1619). The glyph is `aria-hidden`; the words that carry
 * the meaning are on the `Right now` pick the opener reveals (AC6).
 */
function JoinOpener({ className, isBusy, open, onToggle, spawnGlyph }: {
    className: string;
    isBusy?: boolean;
    open: boolean;
    onToggle: () => void;
    spawnGlyph?: string;
}): JSX.Element {
    return (
        <button type="button" data-testid="lfg-join-button" className={className}
            disabled={isBusy} aria-expanded={open} onClick={onToggle}>
            {spawnGlyph ? (
                <><span aria-hidden="true" data-testid="lfg-join-spawn-indicator">{spawnGlyph}</span>{' '}</>
            ) : null}
            {LFG_COPY.join}
        </button>
    );
}

/**
 * `+1 · I'm in`, plus the urgency choice it opens.
 *
 * @param props.label - The game's name, for the choice group's accessible name.
 * @param props.onJoin - Called once, with the pick, on the second click.
 * @param props.className - Button classes supplied by the calling surface.
 * @param props.isBusy - True while a join or withdraw is in flight.
 * @param props.spawnsNow - True when the `Right now` pick would form the group.
 * @param props.spawnEmoji - The indicator glyph to mark the opener and that
 *   pick with.
 */
export function LfgJoinControl({
    label,
    onJoin,
    className,
    isBusy,
    spawnsNow,
    spawnEmoji,
}: LfgJoinControlProps): JSX.Element {
    const [choosing, setChoosing] = useState(false);
    const pick = (chosen: LfgUrgencyPick): void => {
        setChoosing(false);
        onJoin(chosen);
    };
    const spawnGlyph = spawnsNow ? spawnEmoji : undefined;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <JoinOpener className={className} isBusy={isBusy} open={choosing}
                onToggle={() => setChoosing((open) => !open)} spawnGlyph={spawnGlyph} />
            {choosing ? (
                <LfgUrgencyChoice label={label} disabled={isBusy} onPick={pick}
                    spawnGlyph={spawnGlyph} />
            ) : null}
        </div>
    );
}
