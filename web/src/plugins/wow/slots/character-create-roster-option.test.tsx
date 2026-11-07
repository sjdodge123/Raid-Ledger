/**
 * ROK-2128 — the Add character toggle's third option "Guild roster": WoW:
 * Forever only (FLAG 8), hidden with no candidate (no empty tab), and the
 * default only for a user with no character of the game (FLAG 9) — even when
 * Blizzard is configured and Armory would otherwise win.
 */
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CharacterDto, RosterClaimListResponseDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { CharacterCreateImportForm } from './character-create-import-form';

const API_BASE = 'http://localhost:3000';
const FOREVER = 'world-of-warcraft-forever';
const GAME_ID = 7;

const ONE: RosterClaimListResponseDto = {
    truncated: false,
    guilds: [{ guildId: 1, guildName: 'Ledger Test Guild', region: 'us', candidates: [
        { memberId: 11, name: 'Ashen Vale', class: 'Mage', level: 60, source: 'addon_import' },
    ] }],
};

/** Serves the list and counts the requests so an absence assertion runs after the fetch. */
function serveCandidates(list: RosterClaimListResponseDto): { calls: () => number } {
    let n = 0;
    server.use(
        http.get(`${API_BASE}/system/status`, () => HttpResponse.json({ status: 'ok', blizzardConfigured: true })),
        http.get(`${API_BASE}/plugins/wow/roster-claim/candidates`, () => { n += 1; return HttpResponse.json(list); }),
    );
    return { calls: () => n };
}

function Harness({ gameSlug, existing = [] }: { gameSlug: string; existing?: CharacterDto[] }) {
    const [tab, setTab] = useState<'manual' | 'import' | 'roster'>('manual');
    return (
        <>
            <CharacterCreateImportForm onClose={() => {}} gameSlug={gameSlug} gameId={GAME_ID} activeTab={tab}
                onTabChange={setTab} existingCharacters={existing} />
            <span data-testid="active-tab">{tab}</span>
        </>
    );
}

const rosterOption = () => screen.queryByRole('button', { name: 'Guild roster' });

describe('CharacterCreateImportForm — Guild roster option (ROK-2128)', () => {
    it('hides the option when no unclaimed candidate is visible', async () => {
        const api = serveCandidates({ guilds: [], truncated: false });
        renderWithProviders(<Harness gameSlug={FOREVER} />);
        await waitFor(() => expect(api.calls()).toBeGreaterThan(0));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Manual' })).toBeInTheDocument());
        expect(rosterOption()).toBeNull();
        expect(screen.getByTestId('active-tab')).toHaveTextContent('manual');
    });

    it('opens on Guild roster for a user with no Forever character and lists the rows', async () => {
        serveCandidates(ONE);
        renderWithProviders(<Harness gameSlug={FOREVER} />);
        await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('roster'));
        expect(rosterOption()).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByText('Ashen Vale')).toBeInTheDocument();
    });

    it('offers the option but keeps it off the default when the user already owns a Forever character', async () => {
        serveCandidates(ONE);
        const existing = [{ id: 'c0', ruleset: 'normal', isMain: true } as CharacterDto];
        renderWithProviders(<Harness gameSlug={FOREVER} existing={existing} />);
        await waitFor(() => expect(rosterOption()).toBeInTheDocument());
        expect(rosterOption()).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('active-tab')).not.toHaveTextContent('roster');
    });

    it('never asks for candidates on a non-Forever WoW game', async () => {
        const api = serveCandidates(ONE);
        renderWithProviders(<Harness gameSlug="world-of-warcraft" />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Manual' })).toBeInTheDocument());
        expect(api.calls()).toBe(0);
        expect(rosterOption()).toBeNull();
    });
});
