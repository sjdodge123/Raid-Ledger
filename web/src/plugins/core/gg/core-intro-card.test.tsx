/**
 * ROK-2187 — the intro card names the player (signed-in user) and the
 * community (branding); its contract payload carries only `memberSince`.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { GgStoryContext } from '../../../components/gg/gg-story-context';
import type { GgStoryContextValue } from '../../../components/gg/gg-story-context';
import { GgIntroCardView } from './core-intro-card';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, username: 'kes', displayName: 'Kestrel' } }),
}));

const NOOP = (): void => {};
const ctx = (tier: 'full' | 'short', started = true): GgStoryContextValue => ({
    year: 2026, tier, share: { shared: false, slug: null, sharedAt: null }, mascot: null, started,
    start: NOOP, replay: NOOP, audio: { muted: false, toggleMute: NOOP, start: NOOP, pauseMusic: NOOP, resumeMusic: NOOP, reset: NOOP },
});

function renderIntro(tier: 'full' | 'short', started = true): void {
    renderWithProviders(
        <GgStoryContext.Provider value={ctx(tier, started)}><GgIntroCardView payload={{}} year={2026} /></GgStoryContext.Provider>,
    );
}

describe('GG intro card (ROK-2187)', () => {
    it('shows the community name with the year, and greets the player by name', async () => {
        renderIntro('full');
        expect(await screen.findByText('Test Community · 2026')).toBeInTheDocument();
        expect(screen.getByText('Kestrel, it was a big one. About a minute — let’s go.')).toBeInTheDocument();
    });

    it('uses the short-GG line for the short tier', async () => {
        renderIntro('short');
        expect(await screen.findByText('Kestrel, this was the year you joined the party.')).toBeInTheDocument();
    });

    it('Tap to start uses the success token with a white label — no raw palette fill (legible on light and dark)', () => {
        renderIntro('full', false);
        const pill = screen.getByText('Tap to start');
        expect(pill.className).toContain('bg-success');
        expect(pill.className).toContain('text-white');
        expect(pill.className).not.toMatch(/emerald|text-foreground/);
    });

    it('after Tap to start unmounts, focus lands on the enclosing slide (never lost to <body>)', () => {
        renderWithProviders(
            <div role="group" aria-roledescription="slide" aria-label="1 of 3: Intro" tabIndex={-1}>
                <GgStoryContext.Provider value={ctx('full', false)}><GgIntroCardView payload={{}} year={2026} /></GgStoryContext.Provider>
            </div>,
        );
        const tap = screen.getByTestId('gg-tap-to-start');
        tap.focus();
        fireEvent.click(tap);
        expect(document.activeElement).toBe(screen.getByRole('group', { name: '1 of 3: Intro' }));
    });
});
