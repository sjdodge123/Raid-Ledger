import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserRow, type RowHandlers } from './UserManagementRow';
import type { UserManagementDto } from '@raid-ledger/contract';

function makeUser(overrides: Partial<UserManagementDto> = {}): UserManagementDto {
    return {
        id: 1,
        username: 'Alice',
        avatar: null,
        customAvatarUrl: null,
        role: 'member',
        createdAt: '2026-01-01T00:00:00Z',
        deactivatedAt: null,
        discordId: '123456789012345678',
        kickedAt: null,
        bannedAt: null,
        ...overrides,
    };
}

function makeHandlers(): RowHandlers {
    return {
        onRemove: vi.fn(), onReactivate: vi.fn(), onKick: vi.fn(),
        onBan: vi.fn(), onUnkick: vi.fn(), onUnban: vi.fn(),
    };
}

function renderRow(user: UserManagementDto, handlers: RowHandlers, currentUserId?: number) {
    return render(
        <UserRow user={user} currentUserId={currentUserId} onRoleChange={vi.fn()}
            handlers={handlers} isUpdating={false} isBusy={false} />,
    );
}

function openMenu(username: string) {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${username}` }));
}

describe('UserRow — badges', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the username and no status badge for an active user', () => {
        renderRow(makeUser(), makeHandlers());
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('Banned')).not.toBeInTheDocument();
        expect(screen.queryByText('Kicked')).not.toBeInTheDocument();
    });

    it('renders a Kicked badge when kickedAt is set', () => {
        renderRow(makeUser({ kickedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        expect(screen.getByText('Kicked')).toBeInTheDocument();
    });

    it('renders a Banned badge when bannedAt is set', () => {
        renderRow(makeUser({ bannedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        expect(screen.getByText('Banned')).toBeInTheDocument();
    });

    it('renders a Deactivated badge when only deactivatedAt is set', () => {
        renderRow(makeUser({ deactivatedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        expect(screen.getByText('Deactivated')).toBeInTheDocument();
    });

    it('shows Banned (not Deactivated) when both bannedAt and deactivatedAt are set', () => {
        renderRow(makeUser({ bannedAt: '2026-07-01T00:00:00Z', deactivatedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        expect(screen.getByText('Banned')).toBeInTheDocument();
        expect(screen.queryByText('Deactivated')).not.toBeInTheDocument();
    });
});

describe('UserRow — protection & self', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows Protected and no action menu for an admin row', () => {
        renderRow(makeUser({ role: 'admin' }), makeHandlers());
        expect(screen.getByText('Protected')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    });

    it('shows no action menu for the current user on their own active row', () => {
        renderRow(makeUser({ id: 7 }), makeHandlers(), 7);
        expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    });
});

describe('UserRow — kebab menu items by state', () => {
    beforeEach(() => vi.clearAllMocks());

    it('offers Kick / Ban / Remove for an active member', () => {
        renderRow(makeUser(), makeHandlers());
        openMenu('Alice');
        expect(screen.getByRole('menuitem', { name: 'Kick user' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Ban user' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Remove user' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Unkick user' })).not.toBeInTheDocument();
    });

    it('offers Unkick / Ban / Remove for a kicked member', () => {
        renderRow(makeUser({ kickedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        openMenu('Alice');
        expect(screen.getByRole('menuitem', { name: 'Unkick user' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Ban user' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Kick user' })).not.toBeInTheDocument();
    });

    it('offers only Unban / Remove for a banned member', () => {
        renderRow(makeUser({ bannedAt: '2026-07-01T00:00:00Z' }), makeHandlers());
        openMenu('Alice');
        expect(screen.getByRole('menuitem', { name: 'Unban user' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Remove user' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Ban user' })).not.toBeInTheDocument();
    });
});

describe('UserRow — menu item callbacks', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls onKick with the target (including discordId) when Kick is chosen', () => {
        const handlers = makeHandlers();
        renderRow(makeUser({ id: 5, username: 'Bob', discordId: '999' }), handlers);
        openMenu('Bob');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Kick user' }));
        expect(handlers.onKick).toHaveBeenCalledWith({ id: 5, username: 'Bob', discordId: '999' });
    });

    it('calls onBan when Ban is chosen', () => {
        const handlers = makeHandlers();
        renderRow(makeUser({ id: 5, username: 'Bob' }), handlers);
        openMenu('Bob');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Ban user' }));
        expect(handlers.onBan).toHaveBeenCalledWith(expect.objectContaining({ id: 5, username: 'Bob' }));
    });

    it('calls onUnkick when Unkick is chosen on a kicked member', () => {
        const handlers = makeHandlers();
        renderRow(makeUser({ id: 5, username: 'Bob', kickedAt: '2026-07-01T00:00:00Z' }), handlers);
        openMenu('Bob');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Unkick user' }));
        expect(handlers.onUnkick).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    });
});
