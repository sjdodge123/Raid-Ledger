/**
 * ROK-1573/1572/1571 — the LFG top bar: back, copy group link, ⋯ Manage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));

const copyWithToast = vi.fn();
vi.mock('../../lib/clipboard', () => ({
    copyWithToast: (...args: unknown[]) => copyWithToast(...args),
}));

import { LfgTopBar } from './LfgTopBar';

describe('LfgTopBar', () => {
    beforeEach(() => {
        navigate.mockReset();
        copyWithToast.mockReset().mockResolvedValue(true);
    });

    it('goes back one history entry', async () => {
        renderWithProviders(<LfgTopBar onManage={vi.fn()} />);

        await userEvent.click(screen.getByRole('button', { name: 'Go back' }));

        expect(navigate).toHaveBeenCalledWith(-1);
    });

    it('copies the current page URL with a "Link copied" toast', async () => {
        renderWithProviders(<LfgTopBar onManage={vi.fn()} />);

        await userEvent.click(screen.getByTestId('lfg-copy-link'));

        expect(copyWithToast).toHaveBeenCalledWith(
            window.location.href,
            expect.objectContaining({ success: 'Link copied' }),
        );
    });

    it('opens Manage from the ⋯ button', async () => {
        const onManage = vi.fn();
        renderWithProviders(<LfgTopBar onManage={onManage} />);

        await userEvent.click(screen.getByTestId('lfg-manage'));

        expect(onManage).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('lfg-manage')).toHaveAccessibleName('Manage');
    });

    it('hides ⋯ when the viewer cannot manage', () => {
        renderWithProviders(<LfgTopBar onManage={vi.fn()} canManage={false} />);

        expect(screen.getByTestId('lfg-top-bar')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-manage')).toBeNull();
    });
});
