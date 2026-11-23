/**
 * ROK-1173 (AC7) — the profession coverage strip: known count (ROK-2149) + per
 * profession counts, chips that toggle the Profession filter (`aria-pressed`),
 * the scope copy at zero professions, hidden without insights — and, through
 * `useWowMemberFilters`, a chip press really narrows the member list — and
 * (ROK-2281) the profession sort survives unpicking another pill but falls
 * back to the default when Clear all unpicks its own.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { MOCK_CHAR_IDS, PROFESSIONS_FIXTURE, rosterInsightsHandler } from '../../../test/handlers/forever-hub-widgets';
import type { HubMemberRow, HubModule } from '../../hub-module';
import { HubMembers } from '../../../components/hub/hub-members';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { PROFESSION_SCOPE_COPY, WowProfessionCoverage } from './wow-profession-coverage';
import { buildProfessionIndex, toggleValue, type ProfessionCoverage, type ProfessionIndex } from './wow-member-filters.helpers';
import { useWowMemberFilters } from './use-wow-member-filters';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

function row(memberId: number, name: string, characterId: string | null): HubMemberRow {
    return { memberId, name, class: 'Mage', level: 60, rankIndex: 1, rankName: 'Member', effectiveRole: null, characterId, isMain: true };
}

const ROWS: readonly HubMemberRow[] = [
    row(1, 'Brewa', MOCK_CHAR_IDS.thrall),
    row(2, 'Mixer', MOCK_CHAR_IDS.jaina),
    row(3, 'Loner', null),
];
const COVERAGE: readonly ProfessionCoverage[] = [{ name: 'Enchanting', count: 8 }, { name: 'Mining', count: 3 }];
/** Brewa + Mixer (linked) have professions in the fixture; Loner (unlinked) has none. */
const LINKED_INDEX = buildProfessionIndex(PROFESSIONS_FIXTURE.professions);
/** ROK-2149 — the fixture plus Loner's Armory snapshot (memberId 3, no character). */
const SNAPSHOT_PROFESSIONS = [
    ...(PROFESSIONS_FIXTURE.professions ?? []),
    { name: 'Skinning', members: [{ characterId: null, memberId: 3, name: 'Loner', skill: 60, maxSkill: 75, source: 'blizzard' as const }] },
];

function Stateful({ professions, index = LINKED_INDEX }: { professions: readonly ProfessionCoverage[]; index?: ProfessionIndex }): JSX.Element {
    const [selected, setSelected] = useState<readonly string[]>([]);
    return (
        <>
            <WowProfessionCoverage rows={ROWS} professions={professions} index={index} selected={selected} onToggle={(n) => setSelected((s) => toggleValue(s, n))} />
            <output data-testid="selected">{selected.join(',')}</output>
        </>
    );
}

describe('WowProfessionCoverage (ROK-1173 AC7)', () => {
    it('shows the known count and one chip per profession with its member count', () => {
        render(<Stateful professions={COVERAGE} />);
        expect(screen.getByTestId('wow-profession-coverage-linked')).toHaveTextContent('Professions known: 2 of 3');
        expect(screen.getByRole('button', { name: 'Enchanting: 8' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Mining: 3' })).toBeInTheDocument();
    });

    it('counts an unlinked row whose Armory snapshot has professions (ROK-2149 AC-14)', () => {
        render(<Stateful professions={COVERAGE} index={buildProfessionIndex(SNAPSHOT_PROFESSIONS)} />);
        expect(screen.getByTestId('wow-profession-coverage-linked')).toHaveTextContent('Professions known: 3 of 3');
    });

    it('a chip toggles that profession in the filter and reflects it with aria-pressed', async () => {
        render(<Stateful professions={COVERAGE} />);
        const chip = screen.getByRole('button', { name: 'Enchanting: 8' });
        await userEvent.click(chip);
        expect(chip).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('selected')).toHaveTextContent('Enchanting');
        await userEvent.click(chip);
        expect(chip).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
    });

    it('shows the scope copy with zero professions — never "no professions"', () => {
        render(<Stateful professions={[]} />);
        expect(screen.getByTestId('wow-profession-coverage')).toHaveTextContent(PROFESSION_SCOPE_COPY);
        expect(screen.queryByText(/no professions/i)).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders nothing without insights professions (visitor / loading)', () => {
        render(<WowProfessionCoverage rows={ROWS} professions={undefined} index={LINKED_INDEX} selected={[]} onToggle={() => undefined} />);
        expect(screen.queryByTestId('wow-profession-coverage')).toBeNull();
    });
});

const PAGE: GuildPage = {
    guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 3, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function Harness(): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['raids-unused'], queryFn: () => Promise.reject(new Error('unused')), enabled: false });
    const filters = useWowMemberFilters({ page: PAGE, raids }, ROWS);
    return (
        <>
            {filters.lead}
            <output data-testid="active">{filters.activeCount}</output>
            <ul aria-label="listed">{ROWS.filter(filters.matches).map((r) => <li key={r.memberId}>{r.name}</li>)}</ul>
        </>
    );
}

describe('useWowMemberFilters — coverage chip drives the Profession filter (ROK-1173 AC7)', () => {
    it('pressing a chip narrows the list to that profession and counts one active filter', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderWithProviders(<Harness />);
        const mining = await screen.findByRole('button', { name: 'Mining: 1' });
        expect(screen.getByRole('button', { name: 'Alchemy: 2' })).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Brewa', 'Mixer', 'Loner']);
        await userEvent.click(mining);
        expect(mining).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('active')).toHaveTextContent('1');
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Mixer']);
    });

    it('a snapshot-only member gets a chip count and passes the filter (ROK-2149 AC-14)', async () => {
        server.use(rosterInsightsHandler({ all: { ...PROFESSIONS_FIXTURE, professions: SNAPSHOT_PROFESSIONS } }));
        renderWithProviders(<Harness />);
        const skinning = await screen.findByRole('button', { name: 'Skinning: 1' });
        expect(screen.getByTestId('wow-profession-coverage-linked')).toHaveTextContent('Professions known: 3 of 3');
        await userEvent.click(skinning);
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Loner']);
    });
});

/* ROK-2281: the real WoW filter hook inside core's Members list, so pills, Clear all and "Sort by" are wired end to end. */
const SORT_MODULE: HubModule = {
    kind: 'wow_guild', tabs: [], overviewWidgets: [], heroPills: [],
    memberColumns: [
        { id: 'name', header: 'Name', cell: ({ row: r }) => <span>{r.name}</span> },
        { id: 'rank', header: 'Rank', cell: ({ row: r }) => <span>{r.rankName}</span>,
            groupBy: (r) => ({ key: String(r.rankIndex), label: r.rankName ?? '', testId: `guild-rank-${r.rankIndex}` }) },
    ],
    memberRows: () => ROWS,
    memberSearch: (r) => r.name,
    useMemberFilters: useWowMemberFilters,
};

function MembersHarness(): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['raids-unused'], queryFn: () => Promise.reject(new Error('unused')), enabled: false });
    return <HubMembers ctx={{ page: PAGE, raids }} module={SORT_MODULE} />;
}

const originalMatchMedia = window.matchMedia;

describe('Members profession sort — unpicking pills (ROK-2281 ruling 3)', () => {
    afterEach(() => { window.matchMedia = originalMatchMedia; });

    it('keeps the Mining sort when another pill is unpicked, and Clear all drops it back to Rank', async () => {
        window.matchMedia = (query: string) => ({
            matches: query === DESKTOP_MQ, media: query, onchange: null,
            addListener: () => undefined, removeListener: () => undefined,
            addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
        });
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderWithProviders(<MembersHarness />);
        await userEvent.click(await screen.findByTestId('filter-panel-trigger'));
        await userEvent.click(await screen.findByRole('button', { name: 'Mining: 1' }));
        await userEvent.click(screen.getByRole('button', { name: 'Alchemy: 2' }));
        const sort = screen.getByRole('combobox', { name: 'Sort by' });
        await userEvent.selectOptions(sort, 'Mining high→low');
        expect(sort).toHaveValue('profession-mining-desc');
        await userEvent.click(screen.getByRole('button', { name: 'Alchemy: 2' }));
        expect(screen.getByRole('button', { name: 'Alchemy: 2' })).toHaveAttribute('aria-pressed', 'false');
        expect(sort, 'unpicking a different pill keeps the active Mining sort').toHaveValue('profession-mining-desc');
        await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        await waitFor(() => expect(sort, 'Clear all unpicks Mining, so its sort falls back to the default').toHaveValue('rank'));
        expect(screen.queryByRole('option', { name: 'Mining high→low' }), 'no pill picked, no profession sorts').toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Mining: 1' }));
        expect(screen.getByRole('option', { name: 'Mining high→low' })).toBeInTheDocument();
        expect(sort, 'the reset is real state — picking Mining again does not bring the old sort back').toHaveValue('rank');
    });
});
