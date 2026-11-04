import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { CharacterDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockEvent } from '../../../test/factories';
import { JoinSeriesOverlay } from './JoinSeriesOverlay';
import { night, seriesState } from './series-signup.test-helpers';

const env = vi.hoisted(() => ({ desktop: true, mutate: vi.fn(), characters: [] as CharacterDto[] }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: vi.fn(() => env.desktop) }));
vi.mock('../../../hooks/use-characters', () => ({ useMyCharacters: vi.fn(() => ({ data: { data: env.characters } })) }));
vi.mock('../../../hooks/use-series-signup', () => ({ useJoinSeries: vi.fn(() => ({ mutate: env.mutate, isPending: false })) }));

function character(overrides: Partial<CharacterDto>): CharacterDto {
    return {
        id: '33333333-3333-4333-8333-333333333333', userId: 1, gameId: 1, name: 'Thrall', realm: null, class: 'Shaman', spec: null,
        role: 'healer', roleOverride: null, effectiveRole: 'healer', isMain: true, itemLevel: null, externalId: null, avatarUrl: null,
        renderUrl: null, level: null, race: null, faction: null, lastSyncedAt: null, displayOrder: 0, profileUrl: null, region: null,
        ruleset: null, gameVariant: null, equipment: null, talents: null, professions: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
    };
}

const SIX = [10, 11, 12, 13, 14, 15].map((id, i) => night(id, 48 + i * 168, 'will_create'));
const event = createMockEvent({ id: 10, title: 'Weekly Raid Night', recurrenceGroupId: '22222222-2222-4222-8222-222222222222',
    game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null, hasRoles: true } });

describe('JoinSeriesOverlay', () => {
    beforeEach(() => { env.desktop = true; env.mutate = vi.fn(); env.characters = [character({})]; });

    it('opens in a Modal at desktop width', () => {
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(SIX)} onClose={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveTextContent('Join “Weekly Raid Night”');
        expect(screen.queryByTestId('bottom-sheet-footer')).not.toBeInTheDocument();
    });

    it('opens in a BottomSheet below desktop width', () => {
        env.desktop = false;
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(SIX)} onClose={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveTextContent('Join “Weekly Raid Night”');
        expect(screen.getByTestId('bottom-sheet-footer')).toContainElement(screen.getByTestId('join-series-confirm'));
    });

    it('labels the confirm from joinableCount and leaves out the declined line when none is kept', () => {
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(SIX)} onClose={vi.fn()} />);
        expect(screen.getByTestId('join-series-confirm')).toHaveTextContent('Join 6 nights');
        expect(screen.getByText(/6 upcoming nights/)).toBeInTheDocument();
        expect(screen.queryByTestId('join-series-kept')).not.toBeInTheDocument();
    });

    it('says a declined night stays declined when the series has one', () => {
        const nights = [...SIX, night(16, 2000, 'stays_inactive', 'declined')];
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(nights)} onClose={vi.fn()} />);
        expect(screen.getByTestId('join-series-kept')).toHaveTextContent('1 night you declined stays declined.');
    });

    it('posts the main character and its role by default, then the role the user adds', () => {
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(SIX)} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: /Tank/ }));
        fireEvent.click(screen.getByTestId('join-series-confirm'));
        expect(env.mutate).toHaveBeenCalledWith(
            { characterId: '33333333-3333-4333-8333-333333333333', preferredRoles: ['healer', 'tank'] }, expect.anything());
    });

    it('shows "No character" and sends none when the user has no main character', () => {
        env.characters = [character({ isMain: false })];
        renderWithProviders(<JoinSeriesOverlay event={event} state={seriesState(SIX)} onClose={vi.fn()} />);
        expect(screen.getByLabelText('Character')).toHaveDisplayValue('No character');
        fireEvent.click(screen.getByRole('checkbox', { name: /Tank/ }));
        fireEvent.click(screen.getByTestId('join-series-confirm'));
        expect(env.mutate).toHaveBeenCalledWith({ preferredRoles: ['tank'] }, expect.anything());
    });
});
