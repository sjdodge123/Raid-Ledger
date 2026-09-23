/**
 * ROK-1479 — the three-way urgency choice (D2), retuned by ROK-1616.
 *
 * Raising a hand used to be one click meaning "some time this week". It now
 * carries a horizon, so the surface has to ASK — this control is that
 * question, extracted from `lfg-hearted-prompt.tsx` so the prompt stays under
 * its line budget and so the group page can reuse the same vocabulary.
 *
 * ROK-1616 kept the control three wide and changed what the three MEAN:
 * `Right now` · `Tonight` · `This week`, rather than a `now` split into two
 * lifetimes. The player never sees a lifetime again — `now` keeps its
 * half-hour TTL silently, `tonight` and `week` compute their own expiry.
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

/**
 * Quiet default first, then the two urgent ones, soonest-lapsing last-to-first
 * — the slot order ROK-1479 shipped, kept so nobody's muscle memory moves.
 *
 * The amber ramp is the house chip vocabulary (design-system §2.2/§4.3): the
 * loudest horizon takes the `/20` fill the `now` pick already shipped, and
 * `tonight` takes the documented `/10` chip fill one step quieter. Both label
 * in `text-amber-400`, NOT `-300`, because `-300` has no light-family override
 * (§6.9). No raw hex anywhere — fifteen themes remap these.
 */
const CHOICES: readonly Choice[] = [
    {
        key: 'week',
        label: LFG_COPY.urgencyWeek,
        pick: { urgency: 'week' },
        className: 'bg-surface hover:bg-overlay text-foreground',
    },
    {
        key: 'now',
        label: LFG_COPY.urgencyNow,
        // The TTL stays here and only here: the contract still wants a number
        // for `now`, and the picker is the last place that knows one.
        pick: { urgency: 'now', ttlMinutes: 30 },
        className: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400',
    },
    {
        key: 'tonight',
        label: LFG_COPY.urgencyTonight,
        // No `ttlMinutes` KEY at all, for the same reason `week` has none (A2)
        // — the server computes the 04:00 expiry.
        pick: { urgency: 'tonight' },
        className: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400',
    },
];

/**
 * A choice's visible text. ROK-1619: when `spawnGlyph` is set, the `now` pick
 * is the press that forms the group, so it reads `🎉 Right now · starts the
 * group` — the words carry the meaning (AC6), the glyph is `aria-hidden`.
 */
function ChoiceLabel({ choice, spawnGlyph }: { choice: Choice; spawnGlyph?: string }): JSX.Element {
    if (choice.key !== 'now' || !spawnGlyph) return <>{choice.label}</>;
    return (
        <>
            <span aria-hidden="true" data-testid="lfg-spawn-indicator">{spawnGlyph}</span>{' '}
            {choice.label} · {LFG_COPY.urgencyNowStartsGroup}
        </>
    );
}

/**
 * The "when do you want to play?" control.
 *
 * @param label - What is being chosen for (a game name), used to name the
 *   radiogroup-like button group so the three labels are not ambiguous alone.
 * @param disabled - True while a join is in flight; disables all three.
 * @param onPick - Receives a fresh pick object, safe for the caller to spread
 *   straight into the join mutation's variables.
 * @param spawnGlyph - ROK-1619: set only when a `Right now` pick would form
 *   the group; the server-resolved indicator emoji to mark it with.
 */
export function LfgUrgencyChoice({
    label,
    disabled = false,
    onPick,
    spawnGlyph,
}: {
    label: string;
    disabled?: boolean;
    onPick: (pick: LfgUrgencyPick) => void;
    spawnGlyph?: string;
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
                    <ChoiceLabel choice={choice} spawnGlyph={spawnGlyph} />
                </button>
            ))}
        </div>
    );
}
