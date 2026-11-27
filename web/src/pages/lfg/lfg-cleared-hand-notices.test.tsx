/**
 * ROK-2352 §3.2 — the show-once cleared-hand notice: copy with both labels,
 * the label fallback for null labels, one ack per batch of ids (then the
 * groups query refetches, and the banner stays until dismissed), and nothing
 * at all without notices.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LfgClearedHandNoticeDto, LfgGroupListItemDto, LfgGroupListResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import type { LfgGrouping } from '../../plugins/lfg-grouping';
import { LfgClearedHandNotices } from './lfg-cleared-hand-notices';

const api = vi.hoisted(() => ({ getLfgGameGroups: vi.fn(), ackLfgHandNotices: vi.fn() }));
vi.mock('../../lib/api/lfg-group-api', () => api);

const grouping: LfgGrouping = {
    id: 'test-grouping',
    gameSlugs: ['g'],
    groupLabel: (ref) => (ref.groupKey === '' ? 'Any dungeon' : (ref.groupLabel ?? ref.groupKey)),
};
const context = { gameId: 7, gameSlug: 'g', groupKey: '', hubId: null };

function notice(over: Partial<LfgClearedHandNoticeDto> = {}): LfgClearedHandNoticeDto {
    return { intentId: 11, fromGroupKey: 'dungeon:36', fromLabel: 'The Deadmines', toGroupKey: 'raid:409', toLabel: 'Molten Core', ...over };
}

const listed: LfgGroupListItemDto = {
    gameId: 7, gameName: 'WoW', gameSlug: 'g', gameCoverUrl: null,
    activeCount: 0, nowCount: 0, state: null, viabilityThreshold: null, isViable: false,
    hasOwnIntent: false, soonestExpiresAt: null, soonestNowExpiresAt: null, playingNow: null,
    groupKey: 'dungeon:48', groupLabel: 'Blackfathom Deeps',
};

function response(notices?: LfgClearedHandNoticeDto[]): LfgGroupListResponseDto {
    return {
        gameId: 7,
        groups: [listed],
        ...(notices ? { notices } : {}),
    };
}

beforeEach(() => {
    api.getLfgGameGroups.mockReset();
    api.ackLfgHandNotices.mockReset().mockResolvedValue(undefined);
});

describe('LfgClearedHandNotices', () => {
    it('renders the copy with both labels', async () => {
        api.getLfgGameGroups.mockResolvedValue(response([notice()]));
        renderWithProviders(<LfgClearedHandNotices grouping={grouping} context={context} />);
        expect(await screen.findByTestId('lfg-cleared-hand-notice')).toHaveTextContent(
            "Your hand for The Deadmines was withdrawn because you're in Molten Core now.",
        );
    });

    it('falls back to the group view label, the grouping label, then "another group"', async () => {
        api.getLfgGameGroups.mockResolvedValue(response([
            notice({ intentId: 11, fromGroupKey: 'dungeon:48', fromLabel: null, toGroupKey: '', toLabel: null }),
            notice({ intentId: 12, fromGroupKey: 'dungeon:99', fromLabel: null, toGroupKey: 'raid:1', toLabel: null }),
        ]));
        renderWithProviders(<LfgClearedHandNotices grouping={grouping} context={context} />);
        const banner = await screen.findByTestId('lfg-cleared-hand-notice');
        expect(banner).toHaveTextContent("Your hand for Blackfathom Deeps was withdrawn because you're in Any dungeon now.");
        expect(banner).toHaveTextContent("Your hand for another group was withdrawn because you're in another group now.");
    });

    it('acks the shown ids once, refetches, and keeps the banner until dismissed', async () => {
        api.getLfgGameGroups.mockResolvedValueOnce(response([notice({ intentId: 11 }), notice({ intentId: 12 })]))
            .mockResolvedValue(response());
        renderWithProviders(<LfgClearedHandNotices grouping={grouping} context={context} />);
        await screen.findByTestId('lfg-cleared-hand-notice');
        await waitFor(() => expect(api.getLfgGameGroups).toHaveBeenCalledTimes(2));
        expect(api.ackLfgHandNotices).toHaveBeenCalledTimes(1);
        expect(api.ackLfgHandNotices).toHaveBeenCalledWith([11, 12]);
        expect(screen.getByTestId('lfg-cleared-hand-notice')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByTestId('lfg-cleared-hand-notice')).toBeNull();
        expect(api.ackLfgHandNotices).toHaveBeenCalledTimes(1);
    });

    it('renders nothing and acks nothing without notices', async () => {
        api.getLfgGameGroups.mockResolvedValue(response());
        renderWithProviders(<LfgClearedHandNotices grouping={grouping} context={context} />);
        await waitFor(() => expect(api.getLfgGameGroups).toHaveBeenCalled());
        expect(screen.queryByTestId('lfg-cleared-hand-notice')).toBeNull();
        expect(api.ackLfgHandNotices).not.toHaveBeenCalled();
    });

    it('does not fetch or render without an active grouping', () => {
        renderWithProviders(<LfgClearedHandNotices grouping={null} context={context} />);
        expect(api.getLfgGameGroups).not.toHaveBeenCalled();
        expect(screen.queryByTestId('lfg-cleared-hand-notice')).toBeNull();
    });
});
