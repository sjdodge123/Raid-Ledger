import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteamSection } from './identity-sections';

/** Default props for a linked Steam account */
function createLinkedSteamProps(overrides: Record<string, unknown> = {}) {
    return {
        steamStatus: {
            data: { linked: true, personaName: 'Roknua', isPublic: true },
        },
        linkSteam: vi.fn(),
        unlinkSteam: { mutate: vi.fn(), isPending: false },
        syncLibrary: { mutate: vi.fn(), isPending: false },
        syncWishlist: { mutate: vi.fn(), isPending: false },
        ...overrides,
    };
}

describe('SteamSection — linked state', () => {
    it('renders all action buttons when Steam is linked', () => {
        render(<SteamSection {...createLinkedSteamProps()} />);
        expect(screen.getByRole('button', { name: /sync library/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sync wishlist/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
    });

    it('calls syncLibrary.mutate on Sync Library click', async () => {
        const user = userEvent.setup();
        const props = createLinkedSteamProps();
        render(<SteamSection {...props} />);
        await user.click(screen.getByRole('button', { name: /sync library/i }));
        expect(props.syncLibrary.mutate).toHaveBeenCalledOnce();
    });

    it('calls unlinkSteam.mutate on Unlink click', async () => {
        const user = userEvent.setup();
        const props = createLinkedSteamProps();
        render(<SteamSection {...props} />);
        await user.click(screen.getByRole('button', { name: /unlink/i }));
        expect(props.unlinkSteam.mutate).toHaveBeenCalledOnce();
    });

    it('shows Link Steam Account when not linked', () => {
        const props = createLinkedSteamProps({
            steamStatus: { data: { linked: false } },
        });
        render(<SteamSection {...props} />);
        expect(screen.getByRole('button', { name: /link steam account/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /unlink/i })).not.toBeInTheDocument();
    });
});

describe('Regression: ROK-783 — Steam buttons overflow on mobile', () => {
    it('button container uses flex-wrap so buttons can wrap on narrow viewports', () => {
        render(<SteamSection {...createLinkedSteamProps()} />);
        const container = screen.getByTestId('steam-action-buttons');
        expect(container).toBeInTheDocument();
        // The container must allow wrapping (flex-wrap) and must NOT
        // have flex-shrink-0 which would force it to overflow.
        const classes = container.className;
        expect(classes).toContain('flex-wrap');
        expect(classes).not.toContain('flex-shrink-0');
    });

    it('all three buttons are visible and clickable', () => {
        render(<SteamSection {...createLinkedSteamProps()} />);
        const syncLib = screen.getByRole('button', { name: /sync library/i });
        const syncWish = screen.getByRole('button', { name: /sync wishlist/i });
        const unlink = screen.getByRole('button', { name: /unlink/i });
        expect(syncLib).toBeVisible();
        expect(syncLib).toBeEnabled();
        expect(syncWish).toBeVisible();
        expect(syncWish).toBeEnabled();
        expect(unlink).toBeVisible();
        expect(unlink).toBeEnabled();
    });

    it('parent layout stacks vertically on mobile (flex-col) with sm breakpoint for row', () => {
        render(<SteamSection {...createLinkedSteamProps()} />);
        const container = screen.getByTestId('steam-action-buttons');
        // The parent of the button container should use flex-col + sm:flex-row
        const parent = container.parentElement;
        expect(parent).not.toBeNull();
        const parentClasses = parent!.className;
        expect(parentClasses).toContain('flex-col');
        expect(parentClasses).toContain('sm:flex-row');
    });
});
