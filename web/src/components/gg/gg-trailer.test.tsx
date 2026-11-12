/** ROK-2187 — the trailer is a visible framed player; playing it pauses the story and the music. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StoryControlsContext } from '../ui/story-controls';
import { GgStoryContext, type GgStoryContextValue } from './gg-story-context';
import { GgTrailerPlayer } from './gg-trailer';

function setup(): { controls: { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }; audio: GgStoryContextValue['audio'] } {
    const controls = { pause: vi.fn(), resume: vi.fn(), paused: false };
    const audio = { muted: false, toggleMute: vi.fn(), start: vi.fn(), pauseMusic: vi.fn(), resumeMusic: vi.fn(), reset: vi.fn() };
    const ctx: GgStoryContextValue = { year: 2026, tier: 'full', share: { shared: false, slug: null, sharedAt: null }, mascot: null, started: true, start: vi.fn(), replay: vi.fn(), audio };
    render(
        <StoryControlsContext.Provider value={controls}>
            <GgStoryContext.Provider value={ctx}><GgTrailerPlayer videoId="abc123" title="Valheim trailer" /></GgStoryContext.Provider>
        </StoryControlsContext.Provider>,
    );
    return { controls, audio };
}

describe('GgTrailerPlayer (ROK-2187)', () => {
    it('loads nothing until tapped, then plays youtube-nocookie and pauses the story + music', () => {
        const { controls, audio } = setup();
        expect(screen.queryByTitle('Valheim trailer')).toBeNull();
        expect(controls.pause).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /Play trailer/ }));
        expect(screen.getByTitle('Valheim trailer').getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123\?/);
        expect(controls.pause).toHaveBeenCalledTimes(1);
        expect(audio.pauseMusic).toHaveBeenCalledTimes(1);
    });

    it('stopping resumes the story and the music', () => {
        const { controls, audio } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Play trailer/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Stop trailer' }));
        expect(controls.resume).toHaveBeenCalledTimes(1);
        expect(audio.resumeMusic).toHaveBeenCalledTimes(1);
        expect(screen.queryByTitle('Valheim trailer')).toBeNull();
    });
});
