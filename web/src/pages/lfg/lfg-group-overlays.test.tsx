/**
 * ROK-2352 review r1 — the lock-in dialog's plugin pick lives only as long as
 * the open dialog (a cancelled pick never reaches a later Confirm), and a
 * roster that shrank under the open dialog says so (§3.2).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgGroupDetail, createMockLfgMember, createMockOverlapWindow } from '../../test/lfg-factories';
import { LfgGroupOverlays, type LfgOverlayActions } from './lfg-group-overlays';
import type { LfgOverlay } from './use-lfg-overlay';
import type { LfgLockInFieldsProps } from '../../plugins/lfg-grouping';

const WINDOW = createMockOverlapWindow();
const CONTEXT = { gameId: 7, gameSlug: 'world-of-warcraft-classic', groupKey: '', hubId: null };

/** Stand-in plugin fields: one button that picks Deadmines. */
function PickFields({ onChange }: LfgLockInFieldsProps): JSX.Element {
    return <button type="button" onClick={() => onChange({ lfgChosenGroupKey: 'dungeon:36' })}>Pick Deadmines</button>;
}

function makeActions(lockIn: LfgOverlayActions['lockIn']): LfgOverlayActions {
    const noop = vi.fn();
    return {
        startPoll: noop, startNow: noop, lockIn, pickUrgency: noop, withdraw: noop,
        isPollPending: false, isStartNowPending: false, isLockInPending: false, isWithdrawing: false,
    };
}

function renderOverlays(group: LfgGroupDetailDto, overlay: LfgOverlay, lockIn = vi.fn()) {
    const view = (g: LfgGroupDetailDto, o: LfgOverlay): JSX.Element => (
        <LfgGroupOverlays group={g} overlay={o} actions={makeActions(lockIn)} onClose={vi.fn()}
            lockInFields={{ Fields: PickFields, context: CONTEXT }} />
    );
    const utils = renderWithProviders(view(group, overlay));
    return { ...utils, lockIn, rerenderWith: (g: LfgGroupDetailDto, o: LfgOverlay) => utils.rerender(view(g, o)) };
}

describe('LfgGroupOverlays — lock-in', () => {
    it('drops a cancelled instance pick: pick X, close, reopen, Confirm sends no X', async () => {
        const user = userEvent.setup();
        const group = createMockLfgGroupDetail();
        const { lockIn, rerenderWith } = renderOverlays(group, { kind: 'lockin', window: WINDOW });
        await user.click(screen.getByRole('button', { name: 'Pick Deadmines' }));
        rerenderWith(group, { kind: 'none' });
        rerenderWith(group, { kind: 'lockin', window: WINDOW });
        await user.click(screen.getByTestId('lfg-lockin-confirm-submit'));
        expect(lockIn).toHaveBeenCalledTimes(1);
        expect(lockIn.mock.calls[0]?.[2]).toEqual({});
    });

    it('sends the pick made in the open dialog', async () => {
        const user = userEvent.setup();
        const { lockIn } = renderOverlays(createMockLfgGroupDetail(), { kind: 'lockin', window: WINDOW });
        await user.click(screen.getByRole('button', { name: 'Pick Deadmines' }));
        await user.click(screen.getByTestId('lfg-lockin-confirm-submit'));
        expect(lockIn.mock.calls[0]?.[2]).toEqual({ lfgChosenGroupKey: 'dungeon:36' });
    });

    it('says how many members left for the group since the dialog opened', () => {
        const members = [createMockLfgMember({ userId: 1 }), createMockLfgMember({ userId: 2 }), createMockLfgMember({ userId: 3 })];
        const group = createMockLfgGroupDetail({ members, groupKey: 'dungeon:36', groupLabel: 'Deadmines' });
        const overlay: LfgOverlay = { kind: 'lockin', window: WINDOW };
        const { rerenderWith } = renderOverlays(group, overlay);
        expect(screen.queryByTestId('lfg-lockin-members-left')).toBeNull();
        rerenderWith({ ...group, members: members.slice(0, 1) }, overlay);
        expect(screen.getByTestId('lfg-lockin-members-left')).toHaveTextContent(
            '2 members left for Deadmines since you opened this',
        );
    });
});
