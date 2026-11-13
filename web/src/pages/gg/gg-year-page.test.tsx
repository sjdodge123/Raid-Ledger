/**
 * ROK-2187 — `/gg/:year` against MSW: cards with no data are omitted, the
 * sound warning shows before the tap, nothing plays until it (AC9), mute
 * persists and silences the tap, reduced motion skips the colour wash, and the
 * Summary's share toggle reveals the public link + image + music credit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { ggHandlers } from '../../test/mocks/gg-handlers';
import { ggFullCards, ggSnapshotFixture } from '../../test/mocks/fixtures/gg-fixtures';
import { GG_MUTE_KEY } from '../../components/gg/use-gg-audio';
import type { GgOwnerSnapshot } from '../../lib/api/gg-api';
import '../../plugins/core/register';
import { GgYearPage } from './gg-year-page';

const key = (k: string): void => { fireEvent.keyDown(window, { key: k }); };
const pick = (...ids: string[]) => ggFullCards.filter((c) => c.pluginSlug === 'core' && ids.includes(c.cardId));
const MASCOT = { emojiName: 'wololo', imageUrl: '/uploads/gg-mascot/1-png', soundUrl: '/uploads/gg-mascot/2-ogg', volume: 0.8 };

let play: ReturnType<typeof vi.spyOn>;

function renderYear(snapshot: GgOwnerSnapshot = ggSnapshotFixture()): void {
    server.use(...ggHandlers(snapshot), http.get('http://localhost:3000/games/:id', () => HttpResponse.json({ screenshots: [], videos: [] })));
    renderWithProviders(<Routes><Route path="/gg/:year" element={<GgYearPage />} /></Routes>, { initialEntries: ['/gg/2026'] });
}

beforeEach(() => {
    localStorage.clear();
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GG year page (ROK-2187)', () => {
    it('omits a card whose payload has no valid data, and a card no renderer knows', async () => {
        const bad = { pluginSlug: 'core', cardId: 'hubs', order: 90, payload: {} };
        renderYear(ggSnapshotFixture({ cards: [...pick('intro', 'events', 'summary'), bad, { ...bad, cardId: 'mystery' }] }));
        expect(await screen.findByRole('group', { name: '1 of 3: GG 2026' })).toBeInTheDocument();
    });

    it('shows the sound warning before the tap and plays nothing until it', async () => {
        renderYear();
        expect(await screen.findByText('This plays sound')).toBeVisible();
        expect(screen.getByText('Tap to start')).toBeInTheDocument();
        expect(play).not.toHaveBeenCalled();
    });

    it('the tap plays the mascot sound and the GG theme, once each', async () => {
        renderYear(ggSnapshotFixture({ mascot: MASCOT }));
        expect(await screen.findByRole('img', { name: 'wololo' })).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('gg-tap-to-start'));
        expect(play).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('gg-tap-to-start')).toBeNull();
        expect(screen.getByTestId('gg-intro')).toHaveAttribute('data-converted', 'true');
        expect(screen.getByTestId('gg-conversion-wash')).toBeInTheDocument();
    });

    it('mute persists and the tap then plays nothing', async () => {
        renderYear(ggSnapshotFixture({ mascot: MASCOT }));
        fireEvent.click(await screen.findByRole('button', { name: 'Mute GG sound' }));
        expect(screen.getByRole('button', { name: 'Unmute GG sound' })).toHaveAttribute('aria-pressed', 'true');
        expect(localStorage.getItem(GG_MUTE_KEY)).toBe('1');
        expect(screen.getByText('Sound is muted')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('gg-tap-to-start'));
        expect(play).not.toHaveBeenCalled();
    });

    it('reduced motion: no colour wash after the tap', async () => {
        vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
            matches: q.includes('reduce'), media: q, onchange: null, addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        }));
        renderYear();
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        expect(screen.getByTestId('gg-intro')).toHaveAttribute('data-converted', 'true');
        expect(screen.queryByTestId('gg-conversion-wash')).toBeNull();
    });

    it('sharing reveals the public link, the share image and the CC BY music credit', async () => {
        renderYear(ggSnapshotFixture({ cards: pick('intro', 'events', 'summary') }));
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        key('ArrowRight'); key('ArrowRight');
        const toggle = await screen.findByRole('switch', { name: 'Share my GG 2026 publicly' });
        expect(screen.getByText(/Heroic Age" Kevin MacLeod/)).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(await screen.findByTestId('gg-share-url')).toHaveTextContent('/w/abcdefghijklmnop1234');
        expect(screen.getByRole('img', { name: 'Share card preview for GG 2026' }).getAttribute('src'))
            .toBe('http://localhost:3000/gg/public/abcdefghijklmnop1234/card');
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    });
});

describe('GG year page — replay + Save-Data (ROK-2187)', () => {
    it('Replay on the Summary goes back to the intro and re-arms Tap to start', async () => {
        renderYear(ggSnapshotFixture({ cards: pick('intro', 'events', 'summary') }));
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        key('ArrowRight'); key('ArrowRight');
        fireEvent.click(await screen.findByTestId('gg-replay'));
        expect(await screen.findByRole('group', { name: '1 of 3: GG 2026' })).toBeInTheDocument();
        expect(screen.getByTestId('gg-tap-to-start')).toBeInTheDocument();
    });

    it('Replay then Tap to start plays the mascot sound and the theme again', async () => {
        renderYear(ggSnapshotFixture({ cards: pick('intro', 'events', 'summary'), mascot: MASCOT }));
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        key('ArrowRight'); key('ArrowRight');
        fireEvent.click(await screen.findByTestId('gg-replay'));
        play.mockClear();
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        expect(play).toHaveBeenCalledTimes(2);
    });

    it('Save-Data: the top-games card shows no trailer player and the backdrops stay still', async () => {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
        try {
            renderYear(ggSnapshotFixture({ cards: pick('intro', 'top-games') }));
            fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
            key('ArrowRight');
            expect(await screen.findByTestId('gg-trailer-skipped')).toHaveTextContent('Trailer hidden to save data.');
            expect(screen.queryByTestId('gg-trailer-frame')).toBeNull();
            expect(screen.getByTestId('ken-burns-image')).toHaveAttribute('data-motion', 'static');
        } finally {
            Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
        }
    });
});
