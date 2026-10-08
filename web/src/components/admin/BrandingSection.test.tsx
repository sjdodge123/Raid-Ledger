/**
 * BrandingSection (ROK-1653 G3a, forms ruling 1): the community name is a
 * labelled Field, the logo goes through FilePicker, and Save/Reset are shared
 * Buttons. The community accent colour was removed (TDB:991).
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
            data: { communityName: 'Night Raiders', communityLogoUrl: null },
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

describe('BrandingSection — no accent colour (TDB:991)', () => {
    it('renders no Accent Color card, colour picker, swatches or brand-fill sample', () => {
        const { container } = render(<BrandingSection />);
        expect(screen.queryByRole('heading', { name: 'Accent Color' }), 'the Accent Color card must be gone').toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Accent colour' }), 'the accent hex field must be gone').toBeNull();
        expect(container.querySelector('input[type=color]'), 'the accent colour well must be gone').toBeNull();
        expect(screen.queryByRole('button', { name: 'Emerald' }), 'the accent preset swatches must be gone').toBeNull();
        expect(container.querySelector('[data-brand-fill]'), 'the accent Sample Button must be gone').toBeNull();
    });

    it('Save sends only the community name', async () => {
        const user = userEvent.setup();
        render(<BrandingSection />);
        const input = screen.getByRole('textbox', { name: 'Community name' });
        await user.clear(input);
        await user.type(input, 'Dawn Raiders');

        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(mocks.updateBranding.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.updateBranding.mutate.mock.calls[0]?.[0]).toEqual({ communityName: 'Dawn Raiders' });
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
