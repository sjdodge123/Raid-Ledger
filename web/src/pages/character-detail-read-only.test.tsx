/**
 * ROK-2149 — `/hubs/:id/members/:memberId` renders the SAME CharacterDetailPage
 * read-only from the roster-member payload: no owner/admin actions, nothing
 * fetched by the synthetic id, claimed → redirect, 403/404 hub notices, the
 * no-Armory note, and the claim CTA only with `canClaim`. A real character
 * still gets its owner actions (regression).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { WowRosterMemberCharacterSchema, type CharacterDto, type WowRosterMemberResponseDto } from '@raid-ledger/contract';
import { activateWowPlugin } from '../test/activate-wow-plugin';
import { renderWithProviders } from '../test/render-helpers';
import { CharacterDetailPage } from './character-detail-page';
import { lastSeenLabel } from './character-detail-source';

const state = vi.hoisted(() => ({
    member: null as { data?: unknown; error?: unknown } | null,
    characterIds: [] as Array<string | undefined>,
}));

vi.mock('../hooks/use-media-query', () => ({ useMediaQuery: () => false }));
vi.mock('../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 5, role: 'admin' }, isAuthenticated: true }),
}));
vi.mock('../hooks/use-characters', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../hooks/use-characters')>()),
    useMyCharacters: () => ({ data: { data: [] } }),
}));
vi.mock('../hooks/use-character-detail', () => ({
    useCharacterDetail: (id: string | undefined) => {
        state.characterIds.push(id);
        return id ? { data: OWNED, isLoading: false, error: null } : { data: undefined, isLoading: false, error: null };
    },
}));
vi.mock('../hooks/use-roster-member-character', () => ({
    useRosterMemberCharacter: () => ({ data: state.member?.data, isLoading: false, error: state.member?.error ?? null }),
}));

const OWNED = {
    id: 'c1', userId: 5, gameId: 7, name: 'Rok Androl', region: 'us', ruleset: null, gameVariant: 'wow_forever',
    faction: 'alliance', race: 'Night Elf', class: 'Warrior', spec: 'Protection', realm: null, level: 22, itemLevel: 16,
    lastSyncedAt: new Date().toISOString(), equipment: null, avatarUrl: null, isMain: true,
    effectiveRole: 'tank', roleOverride: null, profileUrl: null, addonLinked: true, rosterClaimed: false,
} as unknown as CharacterDto;

const NOW = '2026-11-09T12:00:00.000Z';

function memberPayload(over: Record<string, unknown> = {}): WowRosterMemberResponseDto {
    return WowRosterMemberCharacterSchema.parse({
        id: 'roster-member:42', userId: null, gameId: 7, name: 'Snapshotta', realm: null, class: 'Mage', spec: 'Frost',
        role: 'dps', roleOverride: null, effectiveRole: 'dps', isMain: false, itemLevel: 55, externalId: null, avatarUrl: null,
        renderUrl: null, level: 60, race: 'Gnome', faction: null, lastSyncedAt: NOW, profileUrl: null, region: 'us', ruleset: null,
        gameVariant: 'wow_forever', equipment: null, talents: null, professions: null, professionsSource: null,
        hasManualProfessions: false, displayOrder: 0, createdAt: NOW, updatedAt: NOW,
        readOnly: true, rosterMemberId: 42, hubId: 9, canClaim: false,
        rank: { index: 1, name: 'Officer' }, lastSeen: { online: false, lastOnlineDays: 3 },
        ...over,
    });
}

function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status });
}

function renderAt(path: string) {
    renderWithProviders(
        <Routes>
            <Route path="/characters/:id" element={<CharacterDetailPage />} />
            <Route path="/hubs/:id/members/:memberId" element={<CharacterDetailPage />} />
            <Route path="/hubs/:id" element={<p>hub page</p>} />
        </Routes>,
        { initialEntries: [path] });
}

beforeEach(() => {
    activateWowPlugin();
    state.member = null;
    state.characterIds = [];
});

describe('roster member page (read-only CharacterDetailPage)', () => {
    it('renders the snapshot with the Roster member pill and roster facts, and no owner/admin control', async () => {
        state.member = { data: memberPayload() };
        renderAt('/hubs/9/members/42');
        expect(await screen.findByRole('heading', { name: 'Snapshotta' })).toBeInTheDocument();
        expect(screen.getByTestId('roster-member-pill')).toHaveTextContent('Roster member');
        expect(screen.getByTestId('roster-member-facts')).toHaveTextContent('Rank: Officer · Last seen 3 days ago');
        expect(screen.getByRole('heading', { name: 'Talents' })).toBeInTheDocument();
        expect(within(screen.getByTestId('character-header-actions')).queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryByRole('heading', { name: /quests/i })).not.toBeInTheDocument();
        expect(state.characterIds.filter((id) => id?.startsWith('roster-member:'))).toEqual([]);
    });

    it('redirects a claimed member to its character page', async () => {
        state.member = { data: { claimedCharacterId: '0b6f0a4e-5f53-4c4e-9a5e-4b0f7c3f1a11', rosterMemberId: 42, hubId: 9 } };
        renderAt('/hubs/9/members/42');
        expect(await screen.findByRole('heading', { name: 'Rok Androl' })).toBeInTheDocument();
        expect(state.characterIds).toContain('0b6f0a4e-5f53-4c4e-9a5e-4b0f7c3f1a11');
    });

    it('shows the not-a-member notice with a hub link on 403', async () => {
        state.member = { error: httpError(403) };
        renderAt('/hubs/9/members/42');
        const notice = await screen.findByTestId('roster-member-not-member');
        expect(notice).toHaveTextContent("You're not a member of this guild");
        expect(within(notice).getByRole('link', { name: 'Go to the guild' })).toHaveAttribute('href', '/hubs/9');
    });

    it('shows "This roster member is gone" with a hub link on 404', async () => {
        state.member = { error: httpError(404) };
        renderAt('/hubs/9/members/42');
        const notice = await screen.findByTestId('roster-member-gone');
        expect(notice).toHaveTextContent('This roster member is gone.');
        expect(within(notice).getByRole('link', { name: 'Go to the guild' })).toHaveAttribute('href', '/hubs/9');
    });

    it('replaces Equipment with the no-Armory note and hides Talents/Professions', async () => {
        state.member = { data: memberPayload({ noArmoryReason: 'pending', lastSyncedAt: null, level: 30, race: null, spec: null }) };
        renderAt('/hubs/9/members/42');
        const note = await screen.findByTestId('roster-member-no-armory');
        expect(note).toHaveTextContent("Armory data hasn't been fetched yet — it refreshes hourly.");
        expect(screen.queryByRole('heading', { name: 'Talents' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Professions' })).not.toBeInTheDocument();
    });

    it('offers "Claim this character" only with canClaim', async () => {
        state.member = { data: memberPayload({ canClaim: true }) };
        renderAt('/hubs/9/members/42');
        expect(await screen.findByRole('button', { name: 'Claim this character' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    });

    it('reads as the confirm step from a claim list, with Back', async () => {
        state.member = { data: memberPayload({ canClaim: true, rank: undefined, lastSeen: undefined }) };
        renderAt('/hubs/9/members/42?from=claim');
        expect(await screen.findByRole('button', { name: 'This is my character — claim it' })).toBeInTheDocument();
        expect(within(screen.getByTestId('roster-member-claim')).getByRole('button', { name: 'Back' })).toBeInTheDocument();
        expect(screen.queryByTestId('roster-member-facts')).not.toBeInTheDocument();
    });

    it('a real character page still renders its owner actions and no Roster member pill (regression)', async () => {
        renderAt('/characters/c1');
        expect(await screen.findByRole('heading', { name: 'Rok Androl' })).toBeInTheDocument();
        expect(within(screen.getByTestId('character-header-actions')).queryAllByRole('button').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('roster-member-pill')).not.toBeInTheDocument();
    });
});

describe('lastSeenLabel', () => {
    it('words the export presence', () => {
        expect(lastSeenLabel({ online: true, lastOnlineDays: null })).toBe('Online now');
        expect(lastSeenLabel({ online: false, lastOnlineDays: 0 })).toBe('Last seen today');
        expect(lastSeenLabel({ online: false, lastOnlineDays: 1 })).toBe('Last seen yesterday');
        expect(lastSeenLabel({ online: null, lastOnlineDays: null })).toBeNull();
        expect(lastSeenLabel(undefined)).toBeNull();
    });
});
