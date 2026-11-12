import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { withHttpStatus } from '../../../lib/api/api-error';

const api = vi.hoisted(() => ({
    getGgMascot: vi.fn(),
    getGgMascotOptions: vi.fn(),
    selectGgMascot: vi.fn(),
    fetchGgSoundPreviewUrl: vi.fn(),
}));
vi.mock('../../../lib/api/gg-admin-api', () => api);
vi.mock('../../../lib/config', () => ({ API_BASE_URL: 'http://api.test' }));

import { GgMascotSection } from './gg-mascot-section';

const OPTIONS = {
    emojis: [
        { id: '111', name: 'wololo_guy', animated: false, previewUrl: 'https://cdn.discordapp.com/emojis/111.webp' },
        { id: '222', name: 'gg', animated: true, previewUrl: 'https://cdn.discordapp.com/emojis/222.gif' },
    ],
    sounds: [
        { id: '333', name: 'wololo', volume: 0.8, available: true, emojiName: null },
        { id: '444', name: 'leeroy', volume: 1, available: false, emojiName: null },
    ],
};
const SAVED = {
    emojiId: '111', emojiName: 'wololo_guy', animated: false,
    imageUrl: '/uploads/gg-mascot/111.webp?v=a', soundId: '333', soundName: 'wololo',
    soundUrl: '/uploads/gg-mascot/333.ogg?v=b', volume: 0.8,
};

describe('GgMascotSection (ROK-2187 L10)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.getGgMascotOptions.mockResolvedValue(OPTIONS);
        api.selectGgMascot.mockResolvedValue(SAVED);
    });

    it('saves the picked emoji + sound', async () => {
        api.getGgMascot.mockResolvedValue(null);
        renderWithProviders(<GgMascotSection />);
        fireEvent.click(await screen.findByRole('radio', { name: 'From Discord' }));
        fireEvent.click(await screen.findByTestId('gg-mascot-emoji-111'));
        fireEvent.click(screen.getByTestId('gg-mascot-sound-333'));
        fireEvent.click(screen.getByTestId('gg-mascot-save'));
        await waitFor(() => expect(api.selectGgMascot).toHaveBeenCalled());
        expect(api.selectGgMascot.mock.calls[0]?.[0]).toEqual({ emojiId: '111', soundId: '333' });
    });

    it('disables an unavailable sound', async () => {
        api.getGgMascot.mockResolvedValue(null);
        renderWithProviders(<GgMascotSection />);
        fireEvent.click(await screen.findByRole('radio', { name: 'From Discord' }));
        expect(await screen.findByTestId('gg-mascot-sound-444')).toBeDisabled();
        expect(screen.getByTestId('gg-mascot-sound-333')).not.toBeDisabled();
    });

    it('says the bot is offline and still shows the saved mascot', async () => {
        api.getGgMascot.mockResolvedValue(SAVED);
        api.getGgMascotOptions.mockRejectedValue(withHttpStatus(new Error('offline'), 503));
        renderWithProviders(<GgMascotSection />);
        expect(await screen.findByTestId('gg-mascot-bot-offline')).toBeInTheDocument();
        const img = screen.getByTestId('gg-mascot-current').querySelector('img');
        expect(img?.getAttribute('src')).toBe('http://api.test/uploads/gg-mascot/111.webp?v=a');
    });

    it('re-syncs with the saved ids and removes with nulls', async () => {
        api.getGgMascot.mockResolvedValue(SAVED);
        renderWithProviders(<GgMascotSection />);
        fireEvent.click(await screen.findByTestId('gg-mascot-resync'));
        await waitFor(() => expect(api.selectGgMascot).toHaveBeenCalledTimes(1));
        expect(api.selectGgMascot.mock.calls[0]?.[0]).toEqual({ emojiId: '111', soundId: '333' });
        fireEvent.click(screen.getByTestId('gg-mascot-remove'));
        await waitFor(() => expect(api.selectGgMascot).toHaveBeenCalledTimes(2));
        expect(api.selectGgMascot.mock.calls[1]?.[0]).toEqual({ emojiId: null, soundId: null });
    });
});
