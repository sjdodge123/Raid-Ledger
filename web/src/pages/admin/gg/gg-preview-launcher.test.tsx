/** ROK-2187 L10d — the admin GG panel's "Preview my GG" launcher. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import { renderWithProviders } from '../../../test/render-helpers';

vi.mock('../../../lib/api/gg-admin-api', () => ({
    getGgAdminSettings: vi.fn(() => new Promise(() => {})),
    getGgMascot: vi.fn(() => new Promise(() => {})),
    getGgDryRun: vi.fn(), getGgMascotOptions: vi.fn(), selectGgMascot: vi.fn(),
    updateGgAdminSettings: vi.fn(), recomputeGg: vi.fn(), sendGgNow: vi.fn(), fetchGgSoundPreviewUrl: vi.fn(),
}));

import { GgPreviewLauncher } from './gg-preview-launcher';
import { GgPanel } from '../gg-panel';

const YEAR = new Date().getFullYear();

function renderAt(element: JSX.Element): void {
    renderWithProviders(
        <Routes>
            <Route path="/admin/settings/general/gg" element={element} />
            <Route path="/admin/settings/general/gg/preview/:year" element={<p data-testid="preview-route">preview</p>} />
        </Routes>,
        { initialEntries: ['/admin/settings/general/gg'] },
    );
}

describe('GgPreviewLauncher (ROK-2187 L10d)', () => {
    it('is part of the admin GG panel', () => {
        renderAt(<GgPanel />);
        expect(screen.getByTestId('gg-preview-launch')).toHaveTextContent('Preview my GG');
    });

    it('defaults to the current year and opens the preview route for it', async () => {
        renderAt(<GgPreviewLauncher />);
        expect(screen.getByLabelText('Preview year')).toHaveValue(String(YEAR));
        fireEvent.click(screen.getByTestId('gg-preview-launch'));
        expect(await screen.findByTestId('preview-route')).toBeInTheDocument();
    });

    it('opens the picked year', async () => {
        renderAt(<GgPreviewLauncher />);
        fireEvent.change(screen.getByLabelText('Preview year'), { target: { value: String(YEAR - 1) } });
        fireEvent.click(screen.getByTestId('gg-preview-launch'));
        expect(await screen.findByTestId('preview-route')).toBeInTheDocument();
    });
});
