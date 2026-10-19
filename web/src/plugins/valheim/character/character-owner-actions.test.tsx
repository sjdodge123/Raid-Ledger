/** ROK-1836 L4a — claim button (D9) + admin change-owner sheet (D10). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import type { User } from '../../../hooks/use-auth';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    valheimCharacterClaimed, valheimCharacterUnclaimed, valheimClaimEventsHandler, valheimClaimHandler,
    valheimMemberSearchHandler, valheimOwnerHandler,
} from '../../../test/mocks/valheim-armory-handlers';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import { toast } from '../../../lib/toast';
import { ValheimCharacterOwnerActions } from './character-owner-actions';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const member: User = {
    id: 4, discordId: 'd4', username: 'member2', displayName: null, avatar: null,
    customAvatarUrl: null, steamId: null, onboardingCompletedAt: null,
};
const admin: User = { ...member, id: 1, username: 'admin', role: 'admin' };

function renderActions(character: ValheimCharacterSummary, viewer: User | null) {
    const result = renderWithProviders(<ValheimCharacterOwnerActions character={character} viewer={viewer} />);
    const invalidate = vi.spyOn(result.queryClient, 'invalidateQueries');
    return { ...result, invalidate };
}

const claimButton = () => screen.queryByRole('button', { name: 'Claim this character' });
const ownerButton = () => screen.queryByRole('button', { name: 'Change owner' });

beforeEach(() => {
    media.desktop = true;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});

describe('owner actions — visibility', () => {
    it('shows Claim to a signed-in member on an unclaimed character, and no admin control', () => {
        renderActions(valheimCharacterUnclaimed, member);
        expect(claimButton()).toBeInTheDocument();
        expect(ownerButton()).not.toBeInTheDocument();
    });

    it('hides Claim once the character has an owner', () => {
        renderActions(valheimCharacterClaimed, member);
        expect(claimButton()).not.toBeInTheDocument();
    });

    it('shows a signed-out visitor no claim or owner control', () => {
        renderActions(valheimCharacterUnclaimed, null);
        expect(claimButton()).not.toBeInTheDocument();
        expect(ownerButton()).not.toBeInTheDocument();
    });

    it('shows Change owner to an admin (and Claim too while unclaimed)', () => {
        renderActions(valheimCharacterUnclaimed, admin);
        expect(ownerButton()).toBeInTheDocument();
        expect(claimButton()).toBeInTheDocument();
    });
});

describe('claim flow', () => {
    it('confirms, POSTs the claim, toasts and invalidates the sheet + lists', async () => {
        const hits: string[] = [];
        server.use(valheimClaimHandler(201, hits));
        const { invalidate } = renderActions(valheimCharacterUnclaimed, member);
        await userEvent.click(screen.getByRole('button', { name: 'Claim this character' }));
        const dialog = screen.getByRole('dialog', { name: 'Claim character' });
        expect(within(dialog).getByText('Claim Ragnhild as yours? An admin can change this.')).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Claim' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ragnhild is now yours.'));
        expect(hits).toEqual(['11']);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: valheimArmoryKeys.detail(11) });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: [...valheimArmoryKeys.all, 'characters'] });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('a 409 says someone claimed first and refetches the sheet', async () => {
        server.use(valheimClaimHandler(409));
        const { invalidate } = renderActions(valheimCharacterUnclaimed, member);
        await userEvent.click(screen.getByRole('button', { name: 'Claim this character' }));
        await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Someone claimed this first'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: valheimArmoryKeys.detail(11) });
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('surfaces any other failure with its own message', async () => {
        server.use(valheimClaimHandler(500));
        renderActions(valheimCharacterUnclaimed, member);
        await userEvent.click(screen.getByRole('button', { name: 'Claim this character' }));
        await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
        expect(vi.mocked(toast.error).mock.calls[0]?.[0]).not.toBe('Someone claimed this first');
    });

    it('on a phone the confirm is a modal bottom sheet with focus inside it', async () => {
        media.desktop = false;
        renderActions(valheimCharacterUnclaimed, member);
        await userEvent.click(screen.getByRole('button', { name: 'Claim this character' }));
        const sheet = screen.getByRole('dialog', { name: 'Claim character' });
        expect(sheet).toHaveAttribute('aria-modal', 'true');
        await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    });
});

describe('admin change owner', () => {
    async function openSheet() {
        const bodies: unknown[] = [];
        server.use(valheimOwnerHandler(bodies), valheimClaimEventsHandler(), valheimMemberSearchHandler());
        const rendered = renderActions(valheimCharacterClaimed, admin);
        await userEvent.click(screen.getByRole('button', { name: 'Change owner' }));
        return { ...rendered, bodies, dialog: screen.getByRole('dialog', { name: 'Change owner' }) };
    }

    it('assigns the picked member: PUT {userId}, toast, invalidates the history', async () => {
        const { bodies, dialog, invalidate } = await openSheet();
        await userEvent.type(within(dialog).getByRole('combobox', { name: 'Find a member' }), 'member2');
        await userEvent.click(await screen.findByRole('option', { name: 'member2' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Hrafn now belongs to member2.'));
        expect(bodies).toEqual([{ userId: 4 }]);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: [...valheimArmoryKeys.all, 'claim-events', 12] });
    });

    it('Assign is disabled until a member is picked', async () => {
        const { dialog } = await openSheet();
        expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
    });

    it('Remove owner sends userId null', async () => {
        const { bodies, dialog } = await openSheet();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Remove owner' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Hrafn is unclaimed.'));
        expect(bodies).toEqual([{ userId: null }]);
    });

    it('lists the claim history newest first', async () => {
        const { dialog } = await openSheet();
        const list = await within(dialog).findByRole('list', { name: 'Claim history' });
        const rows = within(list).getAllByRole('listitem').map((li) => li.firstElementChild?.textContent ?? '');
        expect(rows.map((r) => r.split(' · ')[0])).toEqual([
            'Owner removed by an admin', 'Assigned by an admin', 'Claimed by a member',
        ]);
    });
});
