/**
 * ROK-1719 AC5: the Boss & Loot panel hides when every instance on the
 * event has no boss data (hand-seeded WoW: Forever instances).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { BossEncounterDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { BossLootPanel } from './boss-loot-panel';

vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: null, isLoading: false }),
}));

vi.mock('../hooks/use-wowhead-tooltips', () => ({
    useWowheadTooltips: () => {},
}));

const API = 'http://localhost:3000';
const SEEDED_A = { id: 90_000_001, name: 'Hyjal Summit' };
const SEEDED_B = { id: 90_000_002, name: 'Karazhan Crypts' };
const DEADMINES = { id: 63, name: 'The Deadmines' };

function boss(instanceId: number): BossEncounterDto {
    return { id: 1, instanceId, name: 'Edwin VanCleef', order: 1, expansion: 'classic', sodModified: false };
}

function serveBosses(byInstance: Record<number, BossEncounterDto[]>) {
    let calls = 0;
    server.use(http.get(`${API}/plugins/wow-classic/instances/:id/bosses`, ({ params }) => {
        calls += 1;
        return HttpResponse.json(byInstance[Number(params.id)] ?? []);
    }));
    return () => calls;
}

function renderPanel(contentInstances: Record<string, unknown>[]) {
    return renderWithProviders(
        <BossLootPanel contentInstances={contentInstances} gameSlug="world-of-warcraft-forever" />,
    );
}

describe('BossLootPanel — bossless instances (ROK-1719)', () => {
    it('renders nothing once every instance returns an empty boss list', async () => {
        const calls = serveBosses({});
        const { container } = renderPanel([SEEDED_A, SEEDED_B]);
        await waitFor(() => expect(calls()).toBe(2));
        await waitFor(() => expect(screen.queryByText('Loading bosses…')).toBeNull());
        expect(screen.queryByText('Boss & Loot'), 'Boss & Loot header must not render for bossless instances').toBeNull();
        expect(container.innerHTML).toBe('');
    });

    it('renders the panel when at least one instance has bosses', async () => {
        serveBosses({ [DEADMINES.id]: [boss(DEADMINES.id)] });
        renderPanel([SEEDED_A, DEADMINES]);
        expect(await screen.findByText('Edwin VanCleef')).toBeInTheDocument();
        expect(screen.getByText('Boss & Loot')).toBeInTheDocument();
    });
});
