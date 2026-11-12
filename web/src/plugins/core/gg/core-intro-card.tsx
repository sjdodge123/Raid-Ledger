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
import { Button } from '../../../components/ui/button';
import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';
import { useAuth } from '../../../hooks/use-auth';
import { useBranding } from '../../../hooks/use-branding';

const LINES = {
    short: ['This was the year you joined the party.', 'this was the year you joined the party.'],
    full: ['It was a big one. About a minute — let’s go.', 'it was a big one. About a minute — let’s go.'],
} as const;

/**
 * The names the intro shows: the player from the signed-in user, the community
 * from branding (the card payload carries only `memberSince`).
 */
function useIntroNames(): { player: string | null; community: string | null } {
    const { user } = useAuth();
    const { brandingQuery } = useBranding();
    return { player: user?.displayName ?? user?.username ?? null, community: brandingQuery.data?.communityName ?? null };
}

/** "<Player>, it was a big one…" — or the bare sentence when no name is known. */
function introLede(tier: 'full' | 'short', player: string | null): string {
    const [bare, tail] = LINES[tier];
    return player ? `${player}, ${tail}` : bare;
}

function TapToStart({ onStart, muted }: { onStart: () => void; muted: boolean }): JSX.Element {
    return (
        <div className="absolute inset-0 z-10">
            <Button variant="bare" onClick={onStart} data-testid="gg-tap-to-start" className="h-full w-full">
                <span className="flex h-full w-full flex-col items-center justify-end gap-2 pb-20">
                    <span className="rounded-full bg-success px-8 py-3 text-lg font-semibold text-white shadow-lg">Tap to start</span>
                    <span className="flex items-center gap-1.5 text-sm text-secondary">
                        <SpeakerWaveIcon aria-hidden="true" className="h-4 w-4" />
                        {muted ? 'Sound is muted' : 'This plays sound'}
                    </span>
                </span>
            </Button>
        </div>
    );
}

/** The intro card body. */
export function GgIntroCardView({ year }: GgCardProps): JSX.Element {
    const { started, start, mascot, audio, tier } = useGgStory();
    const reduced = usePrefersReducedMotion();
    const { player, community } = useIntroNames();
    return (
        <div className="relative h-full" data-testid="gg-intro" data-converted={started ? 'true' : 'false'}>
            {started && !reduced && (
                <div aria-hidden="true" data-testid="gg-conversion-wash"
                    className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success/40 animate-[gg-wash_1s_ease-out_both]" />
            )}
            <GgCardBody center>
                <GgKicker>{community ? `${community} · ${year}` : 'Your year in Raid Ledger'}</GgKicker>
                {mascot && (
                    <img src={mascot.imageUrl} alt={mascot.emojiName}
                        className={`h-28 w-28 object-contain ${started ? '' : 'grayscale'}`} />
                )}
                <GgTitle display>GG {year}</GgTitle>
                {community && <GgLede><strong>Your year in Raid Ledger</strong></GgLede>}
                <GgLede>{introLede(tier === 'short' ? 'short' : 'full', player)}</GgLede>
            </GgCardBody>
            {!started && <TapToStart onStart={start} muted={audio.muted} />}
        </div>
    );
}
