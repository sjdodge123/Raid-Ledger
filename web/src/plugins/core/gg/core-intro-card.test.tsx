/**
 * ROK-2187 — the intro card names the player (signed-in user) and the
 * community (branding); its contract payload carries only `memberSince`.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { GgStoryContext } from '../../../components/gg/gg-story-context';
import type { GgStoryContextValue } from '../../../components/gg/gg-story-context';
import { GgIntroCardView } from './core-intro-card';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, username: 'kes', displayName: 'Kestrel' } }),
}));

const NOOP = (): void => {};
const ctx = (tier: 'full' | 'short'): GgStoryContextValue => ({
    year: 2026, tier, share: { shared: false, slug: null, sharedAt: null }, mascot: null, started: true,
    start: NOOP, replay: NOOP, audio: { muted: false, toggleMute: NOOP, start: NOOP, pauseMusic: NOOP, resumeMusic: NOOP, reset: NOOP },
});

function renderIntro(tier: 'full' | 'short'): void {
    renderWithProviders(
        <GgStoryContext.Provider value={ctx(tier)}><GgIntroCardView payload={{}} year={2026} /></GgStoryContext.Provider>,
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
});
