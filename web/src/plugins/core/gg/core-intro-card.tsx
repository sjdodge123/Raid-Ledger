/**
 * Card 1 — the GG intro (ROK-2187 "Community mascot intro"). Until "Tap to
 * start" is pressed the card is neutral and nothing advances; the tap (the
 * user gesture iOS needs) plays the mascot sound, fades the GG theme in and
 * runs the colour conversion — an accent wash, skipped under reduced motion.
 * The sound warning is visible before the tap.
 */
import type { JSX } from 'react';
import { SpeakerWaveIcon } from '@heroicons/react/24/outline';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgKicker, GgLede, GgTitle } from '../../../components/gg/gg-card-parts';
import { useGgStory } from '../../../components/gg/gg-story-context';
import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';

function TapToStart({ onStart, muted }: { onStart: () => void; muted: boolean }): JSX.Element {
    return (
        <button type="button" onClick={onStart} data-testid="gg-tap-to-start"
            className="absolute inset-0 z-10 flex flex-col items-center justify-end gap-2 pb-20">
            <span className="rounded-full bg-emerald-600 px-8 py-3 text-lg font-semibold text-foreground shadow-lg">Tap to start</span>
            <span className="flex items-center gap-1.5 text-sm text-secondary">
                <SpeakerWaveIcon aria-hidden="true" className="h-4 w-4" />
                {muted ? 'Sound is muted' : 'This plays sound'}
            </span>
        </button>
    );
}

/** The intro card body. */
export function GgIntroCardView({ year }: GgCardProps): JSX.Element {
    const { started, start, mascot, audio, tier } = useGgStory();
    const reduced = usePrefersReducedMotion();
    return (
        <div className="relative h-full" data-testid="gg-intro" data-converted={started ? 'true' : 'false'}>
            {started && !reduced && (
                <div aria-hidden="true" data-testid="gg-conversion-wash"
                    className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success/40 animate-[gg-wash_1s_ease-out_both]" />
            )}
            <GgCardBody center>
                <GgKicker>Your year in Raid Ledger</GgKicker>
                {mascot && (
                    <img src={mascot.imageUrl} alt={mascot.emojiName}
                        className={`h-28 w-28 object-contain ${started ? '' : 'grayscale'}`} />
                )}
                <GgTitle display>GG {year}</GgTitle>
                <GgLede>{tier === 'short' ? 'This was the year you joined the party.' : 'It was a big one. About a minute — let’s go.'}</GgLede>
            </GgCardBody>
            {!started && <TapToStart onStart={start} muted={audio.muted} />}
        </div>
    );
}
