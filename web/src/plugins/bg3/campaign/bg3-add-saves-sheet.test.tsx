/** ROK-1960 (operator ruling 2026-10-31) — "Add my saves" asks before moving a playthrough out of another hub. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Bg3CrossHubMove } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    bg3BindKeyCrossHubHandler, bg3BindKeyHandler, bg3DefaultCampaignHandler, bg3MySavesHandler,
} from '../../../test/mocks/bg3-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3MySavesResponse } from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import { Bg3AddSavesSheet, BG3_ADD_SAVES_DEFAULT_LABEL } from './bg3-add-saves-sheet';

vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CONFIRM = 'bg3-upload-move-confirm';
const calls: string[] = [];
const onClose = vi.fn();
const elsewhere = { campaignId: 99, campaignName: 'Honour run', hubId: BG3_HUB_ID + 1, hubName: 'Other Crew' };
const MOVE: Bg3CrossHubMove = { code: 'cross_hub_move', saveCount: 3, locations: [elsewhere] };
const record = (b: unknown): void => { calls.push(JSON.stringify(b).includes('confirmCrossHub') ? 'bind+confirm' : 'bind'); };

/** Opens the sheet, ticks QuickSave_2's playthrough (optionally the default box) and presses Add. */
async function addOne(user: ReturnType<typeof userEvent.setup>, alsoDefault = false): Promise<HTMLElement> {
    renderWithProviders(<Bg3AddSavesSheet isOpen hubId={BG3_HUB_ID} campaignId={BG3_CAMPAIGN_ID} campaignName="Tactician run" onClose={onClose} />);
    const sheet = await screen.findByTestId('bg3-add-saves');
    await user.click(within(sheet).getByRole('checkbox', { name: /QuickSave_2/ }));
    if (alsoDefault) await user.click(within(sheet).getByRole('checkbox', { name: BG3_ADD_SAVES_DEFAULT_LABEL }));
    await user.click(screen.getByRole('button', { name: /^Add 1 playthrough/ }));
    return sheet;
}

/** Settled = the sheet asks or has closed, so a wrong path fails on its own assertion rather than a timeout. */
const settled = (): Promise<void> => waitFor(() => expect(screen.queryByTestId(CONFIRM) !== null || onClose.mock.calls.length > 0).toBe(true));

beforeEach(() => {
    calls.length = 0;
    onClose.mockClear();
    vi.mocked(toast.error).mockClear();
    server.use(
        bg3MySavesHandler(buildBg3MySavesResponse()),
        bg3DefaultCampaignHandler(() => calls.push('default')),
    );
});

afterEach(() => expect(toast.error).not.toHaveBeenCalled());

describe('Add my saves — cross-hub bind asks first', () => {
    it('a bind the server accepts adds without asking and closes', async () => {
        server.use(bg3BindKeyHandler(record));
        await addOne(userEvent.setup());
        await settled();
        expect(screen.queryByTestId(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(['bind']);
    });

    it('a 409 cross_hub_move shows the confirm with the server locations; focus lands on Move here; Add is disabled', async () => {
        server.use(bg3BindKeyCrossHubHandler(MOVE, record));
        await addOne(userEvent.setup());
        await settled();
        const confirm = screen.getByTestId(CONFIRM);
        expect(confirm).toHaveTextContent(
            "This playthrough's saves are in Honour run in Other Crew. Moving it here also moves your 3 earlier saves.");
        expect(within(confirm).getByRole('button', { name: 'Move here' })).toHaveFocus();
        expect(screen.getByRole('button', { name: /^Add 1 playthrough/ })).toBeDisabled();
        expect(onClose).not.toHaveBeenCalled();
        expect(calls).toEqual(['bind']);
    });

    it('Cancel sends nothing further and keeps the sheet open', async () => {
        server.use(bg3BindKeyCrossHubHandler(MOVE, record));
        const user = userEvent.setup();
        await addOne(user, true);
        await settled();
        await user.click(within(screen.getByTestId(CONFIRM)).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByTestId(CONFIRM)).not.toBeInTheDocument();
        expect(screen.getByTestId('bg3-add-saves')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Add 1 playthrough/ })).toBeEnabled();
        expect(onClose).not.toHaveBeenCalled();
        expect(calls).toEqual(['bind']);
    });

    it('Move here re-binds with confirmCrossHub, then sets the default and closes', async () => {
        server.use(bg3BindKeyCrossHubHandler(MOVE, record));
        const user = userEvent.setup();
        await addOne(user, true);
        await settled();
        await user.click(within(screen.getByTestId(CONFIRM)).getByRole('button', { name: 'Move here' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(calls).toEqual(['bind', 'bind+confirm', 'default']);
    });
});
