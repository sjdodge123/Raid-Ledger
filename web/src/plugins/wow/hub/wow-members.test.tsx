/**
 * ROK-1173 — the WoW Members row decorations: the "You" pill (AC9), the lazy
 * avatar (AC11), the class dot (AC12) and the professions join (AC8).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { GuildMemberRow, WowRosterInsightsDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { MOCK_CHAR_IDS, PROFESSIONS_FIXTURE, rosterInsightsHandler } from '../../../test/handlers/forever-hub-widgets';
import { FactsCell, NameCell, ProfessionsCell } from './wow-members';
import { classDotClass, professionIndex, rowProfessions } from './wow-member-professions';
import { rowProfessionKey } from '../lib/profession-member-key';

// useRosterInsights is `enabled: isAuthenticated` — without a signed-in viewer
// the professions query never fires and ProfessionsCell stays empty.
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

function row(over: Partial<GuildMemberRow> = {}): GuildMemberRow {
    return { memberId: 1, name: 'Aldren', class: 'Hunter', level: 60, rankIndex: 0, rankName: 'Guild Master', effectiveRole: null, characterId: null, isMain: false, ...over };
}

const LINKED = '11111111-1111-4111-8111-111111111111';

const INSIGHTS = {
    professions: [
        { name: 'Enchanting', members: [{ characterId: LINKED, name: 'Aldren', skill: 300, maxSkill: 300, source: 'addon_import' }] },
        { name: 'First Aid', members: [{ characterId: LINKED, name: 'Aldren', skill: null, maxSkill: null, source: 'addon_import' }] },
    ],
} as unknown as WowRosterInsightsDto;

describe('NameCell (ROK-1173 AC9 / AC11)', () => {
    it('shows a "You" pill only on the viewer own row', () => {
        renderWithProviders(<NameCell row={row({ isViewer: true })} />);
        expect(screen.getByTestId('guild-member-you')).toHaveTextContent('You');
    });

    it('shows no "You" pill on someone else row', () => {
        renderWithProviders(<NameCell row={row()} />);
        expect(screen.queryByTestId('guild-member-you'), 'a row without isViewer must not carry the You pill').toBeNull();
    });

    it('renders the avatar lazily in a fixed 20px box', () => {
        renderWithProviders(<NameCell row={row({ characterId: LINKED, avatarUrl: 'https://cdn.example/a.jpg' })} />);
        const img = screen.getByTestId('guild-member-avatar');
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('width', '20');
        expect(img).toHaveAttribute('height', '20');
        expect(img).toHaveAttribute('src', 'https://cdn.example/a.jpg');
    });

    it('renders no image at all without an avatarUrl (no fallback image)', () => {
        renderWithProviders(<NameCell row={row({ characterId: LINKED, avatarUrl: null })} />);
        expect(screen.queryByTestId('guild-member-avatar'), 'a missing avatar must render nothing').toBeNull();
    });
});

describe('NameCell link targets (ROK-2149 AC-8)', () => {
    function renderInHub(r: GuildMemberRow): void {
        renderWithProviders(
            <Routes><Route path="/hubs/:id" element={<NameCell row={r} />} /></Routes>,
            { initialEntries: ['/hubs/7'] },
        );
    }

    it('links an unlinked row to its read-only roster-member page', () => {
        renderInHub(row({ memberId: 42, characterId: null }));
        const link = screen.getByTestId('guild-member-roster-link');
        expect(link, 'an unlinked row must open /hubs/:id/members/:memberId').toHaveAttribute('href', '/hubs/7/members/42');
        expect(link).toHaveTextContent('Aldren');
        expect(screen.queryByTestId('guild-member-link'), 'an unlinked row must not link to a character page').toBeNull();
    });

    it('keeps a linked row on its character page', () => {
        renderInHub(row({ memberId: 42, characterId: LINKED }));
        expect(screen.getByTestId('guild-member-link')).toHaveAttribute('href', `/characters/${LINKED}`);
        expect(screen.queryByTestId('guild-member-roster-link'), 'a linked row must not point at the roster-member page').toBeNull();
    });

    it('stays plain text outside a hub route (no hub id to build the path)', () => {
        renderWithProviders(<NameCell row={row({ characterId: null })} />);
        expect(screen.getByTestId('guild-member-unlinked')).toHaveTextContent('Aldren');
        expect(screen.queryByRole('link'), 'no hub id → no roster-member link').toBeNull();
    });
});

describe('FactsCell class dot (ROK-1173 AC12)', () => {
    it('paints a known class with its class token', () => {
        renderWithProviders(<FactsCell row={row({ class: 'Hunter' })} />);
        expect(screen.getByTestId('guild-member-class-dot')).toHaveClass('bg-class-hunter');
        expect(screen.getByText('Lv 60 Hunter')).toBeInTheDocument();
    });

    it('draws no dot for an unknown or missing class', () => {
        renderWithProviders(<FactsCell row={row({ class: null })} />);
        expect(screen.queryByTestId('guild-member-class-dot')).toBeNull();
        expect(classDotClass('Death Knight')).toBeNull();
        expect(classDotClass(' warlock ')).toBe('bg-class-warlock');
    });
});

describe('FactsCell Armory spec + item level (ROK-2133)', () => {
    it('shows spec and item level when the row has them', () => {
        renderWithProviders(<FactsCell row={row({ spec: 'Beast Mastery', itemLevel: 118 })} />);
        expect(screen.getByText('Lv 60 Hunter')).toBeInTheDocument();
        expect(screen.getByTestId('guild-member-armory')).toHaveTextContent('Beast Mastery · 118 iLvl');
    });

    it('renders nothing extra when the row has neither', () => {
        renderWithProviders(<FactsCell row={row()} />);
        expect(screen.queryByTestId('guild-member-armory'), 'no Armory data → no empty separator').toBeNull();
    });
});

describe('professions join (ROK-1173 AC8)', () => {
    it('indexes each linked character professions by characterId', () => {
        const found = rowProfessions(professionIndex(INSIGHTS), rowProfessionKey(row({ characterId: LINKED })));
        expect(found?.primary.map((p) => [p.name, p.slug, p.skillLevel])).toEqual([
            ['Enchanting', 'enchanting', 300],
            ['First Aid', 'first-aid', 0],
        ]);
    });

    it('returns nothing for an unlinked row with no snapshot, a stranger, or a visitor payload', () => {
        const index = professionIndex(INSIGHTS);
        expect(rowProfessions(index, rowProfessionKey(row())), 'an unlinked row with no snapshot shows nothing').toBeNull();
        expect(rowProfessions(index, '22222222-2222-4222-8222-222222222222')).toBeNull();
        expect(professionIndex({} as WowRosterInsightsDto).size, 'visitors get no professions key').toBe(0);
        expect(professionIndex(undefined).size).toBe(0);
    });

    it('indexes an unclaimed member by memberId, never onto a linked row (ROK-2149)', () => {
        const snap = { professions: [{ name: 'Herbalism', members: [{ characterId: null, memberId: 1, name: 'Aldren', skill: 50, maxSkill: 75, source: 'blizzard' }] }] } as unknown as WowRosterInsightsDto;
        const index = professionIndex(snap);
        expect(rowProfessions(index, rowProfessionKey(row()))?.primary.map((p) => [p.name, p.skillLevel])).toEqual([['Herbalism', 50]]);
        expect(rowProfessions(index, rowProfessionKey(row({ characterId: LINKED }))), 'a linked row is keyed by its character').toBeNull();
    });

    it('memoises the index per insights payload', () => {
        expect(professionIndex(INSIGHTS)).toBe(professionIndex(INSIGHTS));
    });

    it('renders a linked row’s professions as ProfessionBadges, reading the guild id from /hubs/:id', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderWithProviders(
            <Routes><Route path="/hubs/:id" element={<ProfessionsCell row={row({ characterId: MOCK_CHAR_IDS.thrall })} />} /></Routes>,
            { initialEntries: ['/hubs/7'] },
        );
        const cell = await screen.findByTestId('guild-member-professions');
        expect(within(cell).getByTitle('Alchemy 225/300'), 'AC8: the linked character’s synced profession is shown').toBeInTheDocument();
    });

    it('renders an unlinked row’s Armory-snapshot professions as ProfessionBadges (ROK-2149 AC-14)', async () => {
        const snapshot = { ...PROFESSIONS_FIXTURE, professions: [
            { name: 'Skinning', members: [{ characterId: null, memberId: 1, name: 'Aldren', skill: 60, maxSkill: 75, source: 'blizzard' as const }] },
        ] };
        server.use(rosterInsightsHandler({ all: snapshot }));
        renderWithProviders(
            <Routes><Route path="/hubs/:id" element={<ProfessionsCell row={row()} />} /></Routes>,
            { initialEntries: ['/hubs/7'] },
        );
        const cell = await screen.findByTestId('guild-member-professions');
        expect(within(cell).getByTitle('Skinning 60/75')).toBeInTheDocument();
    });

    it('renders no professions cell for an unlinked row', () => {
        renderWithProviders(<ProfessionsCell row={row()} />);
        expect(screen.queryByTestId('guild-member-professions'), 'AC8: absent, not "none"').toBeNull();
    });
});
