/**
 * BrandingSection (ROK-1653 G3a, forms ruling 1): the community name is a
 * labelled Field, the logo goes through FilePicker, the accent through the
 * swatches + ColorInput, and Save/Reset are shared Buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandingSection } from './BrandingSection';
import { LOGO_ACCEPT_MIME } from '../../constants/branding';

const mocks = vi.hoisted(() => ({
    updateBranding: { mutate: vi.fn(), isPending: false },
    uploadLogo: { mutate: vi.fn(), isPending: false },
    resetBranding: { mutate: vi.fn(), isPending: false },
}));

vi.mock('../../hooks/use-branding', () => ({
    useBranding: () => ({
        brandingQuery: {
            isLoading: false,
            data: { communityName: 'Night Raiders', communityAccentColor: '#10B981', communityLogoUrl: null },
        },
        ...mocks,
    }),
}));

vi.mock('../../lib/config', () => ({ API_BASE_URL: 'http://localhost:3000' }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBranding.isPending = false;
    mocks.uploadLogo.isPending = false;
    mocks.resetBranding.isPending = false;
});

describe('BrandingSection — community name', () => {
    it('is a textbox named "Community name" with the 60-char counter as its hint', () => {
        render(<BrandingSection />);
        const input = screen.getByRole('textbox', { name: 'Community name' });
        expect(input).toHaveValue('Night Raiders');
        expect(input).toHaveAttribute('maxLength', '60');
        expect(input).toHaveAccessibleDescription('13/60');
    });
});

describe('BrandingSection — accent colour', () => {
    it('a clicked swatch becomes aria-pressed and its hex fills the ColorInput', async () => {
        const user = userEvent.setup();
        render(<BrandingSection />);
        const emerald = screen.getByRole('button', { name: 'Emerald' });
        const blue = screen.getByRole('button', { name: 'Blue' });
        expect(emerald).toHaveAttribute('aria-pressed', 'true');
        expect(blue).toHaveAttribute('aria-pressed', 'false');

        await user.click(blue);

        expect(blue).toHaveAttribute('aria-pressed', 'true');
        expect(emerald).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('textbox', { name: 'Accent colour' })).toHaveValue('#3B82F6');
    });
});

describe('BrandingSection — logo', () => {
    it('a file chosen through the FilePicker input is handed to the upload mutation', async () => {
        const user = userEvent.setup();
        const { container } = render(<BrandingSection />);
        const input = container.querySelector('input[type=file]') as HTMLInputElement;
        expect(input).toHaveAttribute('accept', LOGO_ACCEPT_MIME);
        const file = new File(['png'], 'logo.png', { type: 'image/png' });

        await user.upload(input, file);

        expect(mocks.uploadLogo.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.uploadLogo.mutate).toHaveBeenCalledWith(file);
    });

    it('the Upload Logo button keeps its name and is aria-busy while uploading', () => {
        mocks.uploadLogo.isPending = true;
        render(<BrandingSection />);
        expect(screen.getByRole('button', { name: /upload/i })).toHaveAttribute('aria-busy', 'true');
    });
});

describe('BrandingSection — actions', () => {
    it('Save Changes and Reset to Defaults keep the names the smoke spec pins', () => {
        render(<BrandingSection />);
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reset to Defaults' })).toBeInTheDocument();
    });

    it('Save is aria-busy while the update is pending', () => {
        mocks.updateBranding.isPending = true;
        render(<BrandingSection />);
        expect(screen.getByRole('button', { name: /sav/i })).toHaveAttribute('aria-busy', 'true');
    });
});
