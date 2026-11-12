/**
 * ROK-2187 L10d — the admin-only "Preview my GG" route: the same story fed by
 * the live preview payload + the current mascot, a "not saved, not shared"
 * banner, no share toggle, and a friendly 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { GgAdminPreviewDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { withHttpStatus } from '../../../lib/api/api-error';
import { ggFullCards } from '../../../test/mocks/fixtures/gg-fixtures';
import '../../../plugins/core/register';

const api = vi.hoisted(() => ({ getGgPreview: vi.fn(), getGgMascot: vi.fn() }));
vi.mock('../../../lib/api/gg-admin-api', () => api);
vi.mock('../../../lib/config', () => ({ API_BASE_URL: 'http://api.test' }));

import { GgPreviewPage } from './gg-preview-page';

const pick = (...ids: string[]) => ggFullCards.filter((c) => c.pluginSlug === 'core' && ids.includes(c.cardId));
const PREVIEW: GgAdminPreviewDto = {
    schemaVersion: 1, year: 2026, tier: 'full', computedAt: '2026-11-12T10:00:00.000Z',
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-11-12T10:00:00.000Z' },
    cards: pick('intro', 'summary'),
};
const MASCOT = {
    emojiId: '111', emojiName: 'wololo_guy', animated: false, imageUrl: '/uploads/gg-mascot/111.webp',
    soundId: null, soundName: null, soundUrl: null, volume: 0.8,
};

function renderPreview(year = '2026'): void {
    renderWithProviders(
        <Routes><Route path="/admin/settings/general/gg/preview/:year" element={<GgPreviewPage />} /></Routes>,
        { initialEntries: [`/admin/settings/general/gg/preview/${year}`] },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    api.getGgPreview.mockResolvedValue(PREVIEW);
    api.getGgMascot.mockResolvedValue(MASCOT);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GgPreviewPage (ROK-2187 L10d)', () => {
    it('renders the story from the preview payload with the current mascot and the preview banner', async () => {
        renderPreview();
        expect(await screen.findByRole('group', { name: '1 of 2: GG 2026' })).toBeInTheDocument();
        expect(api.getGgPreview).toHaveBeenCalledWith(2026);
        expect(screen.getByTestId('gg-preview-banner')).toHaveTextContent('Preview — not saved, not shared');
        expect(await screen.findByRole('img', { name: 'wololo_guy' })).toHaveAttribute('src', 'http://api.test/uploads/gg-mascot/111.webp');
        expect(screen.getByTestId('gg-tap-to-start')).toBeInTheDocument();
    });

    it('shows no share toggle on the summary card', async () => {
        renderPreview();
        fireEvent.click(await screen.findByTestId('gg-tap-to-start'));
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(await screen.findByTestId('gg-replay')).toBeInTheDocument();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/Share my GG/)).toBeNull();
    });

    it('a 404 reads "No activity yet for <year>"', async () => {
        api.getGgPreview.mockRejectedValue(withHttpStatus(new Error('No activity in 2025'), 404));
        renderPreview('2025');
        expect(await screen.findByTestId('gg-preview-empty')).toHaveTextContent('No activity yet for 2025');
    });
});
