import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserManagementDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { RoleManagementCard } from './RoleManagementCard';
import { useUserManagement } from '../../hooks/use-user-management';

vi.mock('../../hooks/use-user-management', () => ({ useUserManagement: vi.fn() }));
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 99, role: 'admin' } }) }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function makeUser(overrides: Partial<UserManagementDto> = {}): UserManagementDto {
    return {
        id: 1, username: 'Alice', avatar: null, customAvatarUrl: null, role: 'member',
        createdAt: '2026-01-01T00:00:00Z', deactivatedAt: null, discordId: '123456789012345678',
        kickedAt: null, bannedAt: null, ...overrides,
    };
}

function mut() {
    return { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'ok' }), isPending: false };
}

function makeMgmt(items: UserManagementDto[]) {
    return {
        users: { items, isLoading: false, total: items.length, isFetchingNextPage: false, hasNextPage: false, sentinelRef: () => {} },
        updateRole: mut(), removeUser: mut(), reactivateUser: mut(),
        kickUser: mut(), unkickUser: mut(), banUser: mut(), unbanUser: mut(),
    };
}

let mgmt: ReturnType<typeof makeMgmt>;

function setup(items: UserManagementDto[]) {
    mgmt = makeMgmt(items);
    vi.mocked(useUserManagement).mockReturnValue(mgmt as unknown as ReturnType<typeof useUserManagement>);
    return renderWithProviders(<RoleManagementCard />);
}

describe('RoleManagementCard — rendering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders Protected for an admin row and status badges for moderated rows', () => {
        setup([
            makeUser({ id: 1, username: 'Alice' }),
            makeUser({ id: 2, username: 'Zed', role: 'admin' }),
            makeUser({ id: 3, username: 'Kate', kickedAt: '2026-07-01T00:00:00Z' }),
            makeUser({ id: 4, username: 'Ben', bannedAt: '2026-07-01T00:00:00Z' }),
        ]);
        expect(screen.getByText('Protected')).toBeInTheDocument();
        expect(screen.getByText('Kicked')).toBeInTheDocument();
        expect(screen.getByText('Banned')).toBeInTheDocument();
    });
});

describe('RoleManagementCard — moderation flows', () => {
    beforeEach(() => vi.clearAllMocks());

    it('opens the Ban modal from the kebab and calls banUser on confirm', async () => {
        setup([makeUser({ id: 1, username: 'Alice' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Alice' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Ban user' }));
        expect(screen.getByText('Ban Alice')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
        await waitFor(() =>
            expect(mgmt.banUser.mutateAsync).toHaveBeenCalledWith({
                userId: 1,
                body: { reason: undefined, wipeData: false, kickFromDiscord: false },
            }),
        );
    });

    it('opens the Kick modal from the kebab and calls kickUser on confirm', async () => {
        setup([makeUser({ id: 5, username: 'Bob' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Bob' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Kick user' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kick' }));
        await waitFor(() =>
            expect(mgmt.kickUser.mutateAsync).toHaveBeenCalledWith({
                userId: 5,
                body: { reason: undefined, kickFromDiscord: false },
            }),
        );
    });

    it('fires unkickUser directly (no modal) when Unkick is chosen', async () => {
        setup([makeUser({ id: 3, username: 'Kate', kickedAt: '2026-07-01T00:00:00Z' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Kate' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Unkick user' }));
        await waitFor(() => expect(mgmt.unkickUser.mutateAsync).toHaveBeenCalledWith(3));
    });
});
