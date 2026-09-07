/**
 * ROK-1479 — the three-way urgency choice (D2).
 *
 * Raising a hand used to be one click meaning "some time this week". A `now`
 * intent lapses in 30 or 60 minutes, so the surface has to ASK — this control
 * is that question, extracted from `lfg-hearted-prompt.tsx` so the prompt stays
 * under its line budget and so the group page can reuse the same vocabulary.
 *
 * Every choice is a real `<button type="button">`: Enter and Space then work
 * without a keydown handler, and the browser's own focus ring is the one the
 * rest of the app already draws.
 *
 * A2 is why the weekly pick is `{ urgency: 'week' }` and not
 * `{ urgency: 'week', ttlMinutes: undefined }` — the contract REJECTS the pair
 * rather than dropping the TTL, so the key must be absent, not falsy.
 */
import type { JSX } from 'react';
import type { LfgNowTtl, LfgUrgency } from '@raid-ledger/contract';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';

/** What the viewer chose. `ttlMinutes` exists only on a `now` pick (A2). */
export interface LfgUrgencyPick {
    urgency: LfgUrgency;
    ttlMinutes?: LfgNowTtl;
}

interface Choice {
    /** Stable testid suffix — the smoke spec addresses these. */
    key: string;
    label: string;
    pick: LfgUrgencyPick;
    className: string;
}

/** Quiet default first, then the two loud ones, soonest-lapsing first. */
const CHOICES: readonly Choice[] = [
    {
        key: 'week',
        label: LFG_COPY.urgencyWeek,
        pick: { urgency: 'week' },
        className: 'bg-surface hover:bg-overlay text-foreground',
    },
    {
        key: 'now-30',
        label: LFG_COPY.urgencyNow30,
        pick: { urgency: 'now', ttlMinutes: 30 },
        className: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400',
    },
    {
        key: 'now-60',
        label: LFG_COPY.urgencyNow60,
        pick: { urgency: 'now', ttlMinutes: 60 },
        className: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400',
    },
];

/**
 * The "when do you want to play?" control.
 *
 * @param label - What is being chosen for (a game name), used to name the
 *   radiogroup-like button group so the three labels are not ambiguous alone.
 * @param disabled - True while a join is in flight; disables all three.
 * @param onPick - Receives a fresh pick object, safe for the caller to spread
 *   straight into the join mutation's variables.
 */
export function LfgUrgencyChoice({
    label,
    disabled = false,
    onPick,
}: {
    label: string;
    disabled?: boolean;
    onPick: (pick: LfgUrgencyPick) => void;
}): JSX.Element {
    return (
        <div
            role="group"
            aria-label={`${LFG_COPY.urgencyPrompt} ${label}`}
            data-testid="lfg-urgency-choice"
            className="flex flex-wrap items-center gap-2"
        >
            {CHOICES.map((choice) => (
                <button
                    key={choice.key}
                    type="button"
                    data-testid={`lfg-urgency-${choice.key}`}
                    disabled={disabled}
                    onClick={() => onPick({ ...choice.pick })}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${choice.className}`}
                >
                    {choice.label}
                </button>
            ))}
        </div>
    );
}
