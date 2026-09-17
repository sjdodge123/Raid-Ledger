/** ROK-1573/1571 — the LFG dialog container: sheet below 768px, modal from 768px. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgMember } from '../../test/lfg-factories';
import { LfgConfirmActions, LfgMemberRow, LfgSheetOrModal } from './LfgSheetOrModal';

let isPhone = false;
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => isPhone }));

describe('LfgSheetOrModal', () => {
    beforeEach(() => {
        isPhone = false;
    });

    it('renders nothing while closed', () => {
        renderWithProviders(<LfgSheetOrModal isOpen={false} onClose={vi.fn()} title="Manage"><p>body</p></LfgSheetOrModal>);
        expect(screen.queryByText('body')).not.toBeInTheDocument();
    });

    it('uses the modal from 768px (no sheet title row)', () => {
        renderWithProviders(<LfgSheetOrModal isOpen onClose={vi.fn()} title="Manage"><p>body</p></LfgSheetOrModal>);
        expect(screen.getByText('body')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-sheet-title')).not.toBeInTheDocument();
    });

    it('uses the bottom sheet with the shipped title row below 768px', () => {
        isPhone = true;
        renderWithProviders(<LfgSheetOrModal isOpen onClose={vi.fn()} title="Manage"><p>body</p></LfgSheetOrModal>);
        expect(screen.getByTestId('lfg-sheet-title')).toHaveTextContent('Manage');
        expect(screen.getByText('body')).toBeInTheDocument();
    });
});

describe('LfgMemberRow', () => {
    it('prefers the display name and falls back to the username', () => {
        renderWithProviders(
            <ul>
                <LfgMemberRow member={createMockLfgMember({ displayName: 'Ana' })} />
                <LfgMemberRow member={createMockLfgMember({ userId: 2, displayName: null, username: 'bo' })} />
            </ul>,
        );
        expect(screen.getByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('bo')).toBeInTheDocument();
    });
});

describe('LfgConfirmActions', () => {
    it('disables only the primary while pending', async () => {
        const onConfirm = vi.fn();
        renderWithProviders(
            <LfgConfirmActions primary="Go" testIdPrefix="x" isPending onCancel={vi.fn()} onConfirm={onConfirm} />,
        );
        expect(screen.getByTestId('x-submit')).toBeDisabled();
        expect(screen.getByTestId('x-cancel')).toBeEnabled();
        await userEvent.click(screen.getByTestId('x-submit'));
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
