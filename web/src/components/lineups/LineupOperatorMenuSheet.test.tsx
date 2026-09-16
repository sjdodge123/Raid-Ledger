/**
 * ROK-1584 (design §4) — on a phone the lineup operator `⋮` opens a BOTTOM
 * SHEET instead of the 224px popover anchored to a 32px glyph. Same items,
 * same gates, same testids, same modals; the desktop dropdown is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLineupDetail } from '../../test/lineup-factories';
import { LineupOperatorMenu } from './LineupOperatorMenu';

vi.mock('../../hooks/use-lineups', () => ({
    useTransitionLineupStatus: () => ({ mutate: vi.fn(), isPending: false }),
    useTogglePublicShare: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateLineupMetadata: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: { id: 99, role: 'operator' } })),
    isOperatorOrAdmin: vi.fn(() => true),
}));

import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

function renderMenu(desktop: boolean) {
    stubViewport(desktop);
    const lineup = createMockLineupDetail({
        title: 'Friday night lineup',
        status: 'building',
    } as Parameters<typeof createMockLineupDetail>[0]);
    renderWithProviders(<LineupOperatorMenu lineup={lineup} />);
    fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
}

describe('LineupOperatorMenu — phone sheet (ROK-1584)', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue({
            user: { id: 99, role: 'operator' },
        } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(true);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens a sheet with the lineup title and the operator items', () => {
        renderMenu(false);
        expect(
            screen.getByRole('dialog', { name: 'Lineup menu' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('lineup-operator-menu-title')).toHaveTextContent(
            'Friday night lineup',
        );
        expect(screen.getByRole('menuitem', { name: 'Edit lineup' })).toBeInTheDocument();
        expect(
            screen.getByRole('menuitem', { name: 'Advance to Voting' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('lineup-operator-menu-revert')).toBeDisabled();
        expect(
            screen.getByRole('menuitem', { name: 'Abort lineup' }),
        ).toBeInTheDocument();
    });

    it('gives the sheet rows a 52px target and the abort row the red family', () => {
        renderMenu(false);
        const edit = screen.getByTestId('lineup-operator-menu-edit');
        expect(Array.from(edit.classList)).toContain('min-h-[52px]');
        expect(
            screen.getByTestId('lineup-operator-menu-abort').className,
        ).toContain('text-rose-300');
    });

    it('still opens the existing Edit modal from the sheet row', () => {
        renderMenu(false);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-edit'));
        expect(screen.queryByTestId('lineup-operator-menu-title')).toBeNull();
        expect(screen.getByRole('dialog')).toHaveTextContent(/edit/i);
    });

    it('does not close the sheet on a press inside one of its rows (Codex P1)', () => {
        renderMenu(false);
        fireEvent.mouseDown(screen.getByTestId('lineup-operator-menu-edit'));
        expect(screen.getByRole('dialog', { name: 'Lineup menu' })).toBeInTheDocument();
    });

    it('keeps the popover dropdown on desktop', () => {
        renderMenu(true);
        expect(screen.queryByRole('dialog')).toBeNull();
        const menu = screen.getByTestId('lineup-operator-menu');
        expect(Array.from(menu.classList)).toContain('absolute');
        expect(screen.getByTestId('lineup-operator-menu-edit')).toBeInTheDocument();
    });
});
