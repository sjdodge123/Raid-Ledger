/** ROK-2068 — Manage my saves: month groups, tri-state month pick, confirm step, POST me/saves/remove. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Bg3MySave } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { bg3MySavesHandler, bg3RemoveSavesHandler } from '../../../test/mocks/bg3-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignSummary, buildBg3MySave, buildBg3MySavesResponse } from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import { bg3MonthLabel } from '../lib/bg3-playthroughs';
import { BG3_REMOVE_SAVES_RESEND_NOTE } from './bg3-remove-saves-confirm';
import { Bg3ManageSavesSheet, BG3_MANAGE_SAVES_ERROR_TOAST, BG3_MANAGE_SAVES_OVER_CAP_NOTE } from './bg3-manage-saves-sheet';

vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
// Mid-month noon UTC, so the local month is the same in every time zone.
const AUG = '2024-08-14T12:00:00.000Z';
const OCT = '2026-10-15T12:00:00.000Z';
const REMOVED = { saves: 3, campaignKeys: 2, thumbnailRefs: 1, galleryPictures: 1 };
const onClose = vi.fn();
const bodies: unknown[] = [];

/** a = 2 saves in Tactician run, b = 1 save filed in another hub, both August 2024; c = 1 unfiled save, October 2026. */
function saves(): Bg3MySave[] {
    return [
        buildBg3MySave({ id: 1, saveName: 'QuickSave_1', campaignKey: A, savedAt: AUG, campaignId: BG3_CAMPAIGN_ID }),
        buildBg3MySave({ id: 2, saveName: 'QuickSave_1', campaignKey: A, savedAt: '2024-08-10T12:00:00.000Z', campaignId: BG3_CAMPAIGN_ID }),
        buildBg3MySave({ id: 3, saveName: 'QuickSave_2', campaignKey: B, savedAt: '2024-08-12T12:00:00.000Z', campaignId: 99 }),
        buildBg3MySave({ id: 4, saveName: 'QuickSave_3', campaignKey: C, savedAt: OCT }),
    ];
}

function renderSheet(): ReturnType<typeof userEvent.setup> {
    renderWithProviders(<Bg3ManageSavesSheet isOpen hubId={BG3_HUB_ID} campaigns={[buildBg3CampaignSummary()]} onClose={onClose} />);
    return userEvent.setup();
}

const monthBox = (iso: string): Promise<HTMLElement> => screen.findByRole('checkbox', { name: bg3MonthLabel(iso) });
const row = (name: string): HTMLElement => screen.getByRole('checkbox', { name });

beforeEach(() => {
    bodies.length = 0;
    onClose.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    server.use(bg3MySavesHandler(buildBg3MySavesResponse({ saves: saves() })), bg3RemoveSavesHandler({ removed: REMOVED }, (b) => bodies.push(b)));
});

describe('Manage my saves — the list', () => {
    it('groups every playthrough (filed or not) by month, newest month first, and names where filed ones live', async () => {
        renderSheet();
        await monthBox(AUG);
        expect(screen.getAllByTestId('bg3-manage-saves-month').map((m) => m.dataset['month'])).toEqual(['2026-10', '2024-08']);
        const august = screen.getByRole('list', { name: bg3MonthLabel(AUG) });
        expect(within(august).getAllByRole('checkbox')).toHaveLength(2);
        expect(row('QuickSave_1')).toHaveAccessibleDescription(/^2 saves · .* · In Tactician run$/);
        expect(row('QuickSave_2')).toHaveAccessibleDescription(/^1 save · .* · In another hub's campaign$/);
        expect(row('QuickSave_3')).not.toHaveAccessibleDescription(/ In /);
    });
});

describe('Manage my saves — month checkbox', () => {
    it('ticks the whole month, goes indeterminate when one row is unticked, and the footer counts the picks', async () => {
        const user = renderSheet();
        const august = await monthBox(AUG);
        expect(screen.getByRole('button', { name: /^Remove 0 playthroughs/ })).toBeDisabled();
        await user.click(august);
        expect(row('QuickSave_1')).toBeChecked();
        expect(row('QuickSave_2')).toBeChecked();
        expect(row('QuickSave_3')).not.toBeChecked();
        expect(august).toBeChecked();
        expect(screen.getByRole('button', { name: 'Remove 2 playthroughs · 3 saves' })).toBeEnabled();
        await user.click(row('QuickSave_2'));
        expect(august).toBePartiallyChecked();
        expect(screen.getByRole('button', { name: 'Remove 1 playthrough · 2 saves' })).toBeEnabled();
        await user.click(august);
        expect(august).toBeChecked();
        await user.click(august);
        expect(august).not.toBeChecked();
        expect(august).not.toBePartiallyChecked();
        expect(row('QuickSave_1')).not.toBeChecked();
    });

    it('disables Remove past the 500-playthrough cap and says why', async () => {
        const many = Array.from({ length: 501 }, (_, i) => buildBg3MySave({ id: 1000 + i, saveName: `Save_${i}`, campaignKey: i.toString(16).padStart(64, '0'), savedAt: AUG }));
        server.use(bg3MySavesHandler(buildBg3MySavesResponse({ saves: many })));
        const user = renderSheet();
        await user.click(await monthBox(AUG));
        expect(screen.getByTestId('bg3-manage-saves-over-cap')).toHaveTextContent(BG3_MANAGE_SAVES_OVER_CAP_NOTE);
        expect(screen.getByRole('button', { name: 'Remove 501 playthroughs · 501 saves' })).toBeDisabled();
    }, 30_000);
});

describe('Manage my saves — remove', () => {
    async function pickAugustAndOpenConfirm(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
        await user.click(await monthBox(AUG));
        await user.click(screen.getByRole('button', { name: 'Remove 2 playthroughs · 3 saves' }));
        return screen.getByTestId('bg3-remove-saves-confirm');
    }

    it('asks first: the confirm counts the saves, says a re-sent save is added again, and sends nothing yet', async () => {
        const user = renderSheet();
        const confirm = await pickAugustAndOpenConfirm(user);
        expect(screen.getByText('Remove 2 playthroughs?')).toBeInTheDocument();
        expect(confirm).toHaveTextContent('This deletes 3 saves you uploaded and their pictures in hub Galleries.');
        expect(confirm).toHaveTextContent(BG3_REMOVE_SAVES_RESEND_NOTE);
        expect(confirm).not.toHaveTextContent(/won't be added|stay removed|stay gone/);
        await user.click(screen.getByRole('button', { name: 'Back' }));
        expect(await monthBox(AUG)).toBeChecked();
        expect(bodies).toEqual([]);
    });

    it('Remove saves POSTs exactly the picked keys, toasts the count and clears the picks', async () => {
        const user = renderSheet();
        await pickAugustAndOpenConfirm(user);
        await user.click(screen.getByRole('button', { name: 'Remove saves' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed 3 saves.'));
        expect(bodies).toEqual([{ campaignKeys: [A, B] }]);
        expect(await monthBox(AUG)).not.toBeChecked();
        expect(toast.error).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('an error toasts and keeps the confirm open with the picks', async () => {
        server.use(bg3RemoveSavesHandler({ removed: REMOVED }, (b) => bodies.push(b), 500));
        const user = renderSheet();
        await pickAugustAndOpenConfirm(user);
        await user.click(screen.getByRole('button', { name: 'Remove saves' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(BG3_MANAGE_SAVES_ERROR_TOAST));
        expect(toast.success).not.toHaveBeenCalled();
        expect(screen.getByTestId('bg3-remove-saves-confirm')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove saves' })).toBeEnabled();
    });
});

describe('Manage my saves — closing', () => {
    it('Cancel with picks asks to discard and removes nothing; without picks it just closes', async () => {
        const user = renderSheet();
        await user.click(await monthBox(OCT));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByText('Nothing will be removed.')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));
        await user.click(row('QuickSave_3'));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(bodies).toEqual([]);
    });
});
