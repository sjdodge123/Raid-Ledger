/**
 * ROK-1745: quest tracking section on the WoW: Forever character page —
 * hidden states, summary line, quest log objectives and completed groups.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CharacterQuestsDto, CharacterQuestsResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { CharacterQuestsSection } from './character-quests-section';

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const URL = `http://localhost:3000/plugins/wow/characters/${CHAR_ID}/quests`;

function makeQuests(overrides: Partial<CharacterQuestsDto> = {}): CharacterQuestsDto {
    return {
        source: 'addon',
        syncedAt: '2026-10-01T12:00:00.000Z',
        inProgress: [
            {
                // Instance 129 has no completed group: the tag must come from the entry itself.
                questId: 100, title: 'The Defias Brotherhood', dungeonInstanceId: 129, instanceName: 'Razorfen Downs',
                objectives: [
                    { text: 'Edwin VanCleef slain', done: true, have: 1, need: 1 },
                    { text: 'Red Silk Bandana', done: false, have: 3, need: 8 },
                    { text: 'Speak to Gryan', done: false, have: null, need: null },
                ],
            },
            { questId: 92472, title: 'Untracked Errand', dungeonInstanceId: null, instanceName: null, objectives: [] },
        ],
        completedKnown: [
            {
                dungeonInstanceId: 63, instanceName: 'The Deadmines', knownCount: 6,
                completed: [{ questId: 200, name: 'Oh Brother. . .', questLevel: 20, chain: [] }],
            },
            {
                dungeonInstanceId: 48, instanceName: 'Blackfathom Deeps', knownCount: 8,
                completed: [{
                    questId: 300, name: 'Step B', questLevel: 24,
                    chain: [
                        { questId: 299, name: 'Step A', done: true },
                        { questId: 300, name: 'Step B', done: true },
                        { questId: 301, name: 'Step C', done: false },
                    ],
                }],
            },
        ],
        counts: { completedKnown: 2, knownTotal: 377, completedTotal: 120, inProgress: 2 },
        ...overrides,
    };
}

let body: CharacterQuestsResponse | null;
let requests = 0;

beforeEach(() => {
    body = { quests: makeQuests() };
    requests = 0;
    server.use(http.get(URL, () => {
        requests += 1;
        return body ? HttpResponse.json(body) : HttpResponse.json({ message: 'boom' }, { status: 500 });
    }));
});

function renderSection(variant: string | null = 'wow_forever') {
    return renderWithProviders(<CharacterQuestsSection characterId={CHAR_ID} variant={variant} />);
}

async function renderLoaded() {
    renderSection();
    return screen.findByRole('heading', { name: 'Quests' });
}

describe('CharacterQuestsSection — hidden states', () => {
    it('renders nothing when the envelope carries quests: null', async () => {
        body = { quests: null };
        const { container } = renderSection();
        await waitFor(() => expect(requests).toBe(1));
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the request fails', async () => {
        body = null;
        const { container } = renderSection();
        await waitFor(() => expect(requests).toBeGreaterThan(0));
        expect(container).toBeEmptyDOMElement();
    });

    it('makes no request for a non-Forever variant', async () => {
        const { container } = renderSection('classic_era');
        await new Promise((r) => setTimeout(r, 20));
        expect(requests).toBe(0);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('CharacterQuestsSection — summary + quest log', () => {
    it('says "1 quest total" for a single completed quest (ROK-1758)', async () => {
        body = { quests: makeQuests({ counts: { completedKnown: 1, knownTotal: 377, completedTotal: 1, inProgress: 2 } }) };
        await renderLoaded();
        expect(screen.getByText('1 completed · 377 known · via addon · 1 Oct 2026 · 1 quest total')).toBeInTheDocument();
    });

    it('says no completed quests are recorded yet instead of "0 quests total" when the completed list is empty — log-only or synced-empty, same DTO (ROK-2145)', async () => {
        body = { quests: makeQuests({ completedKnown: [], counts: { completedKnown: 0, knownTotal: 377, completedTotal: 0, inProgress: 2 } }) };
        await renderLoaded();
        expect(screen.getByText('No completed quests recorded yet · via addon · 1 Oct 2026')).toBeInTheDocument();
        expect(screen.queryByText(/quests total/)).not.toBeInTheDocument();
    });

    it('shows counts, source, date and the total completed', async () => {
        await renderLoaded();
        expect(screen.getByText('2 completed · 377 known · via addon · 1 Oct 2026 · 120 quests total')).toBeInTheDocument();
    });

    it('shows "via Armory" and the completed-list date for an Armory-only character (ROK-2109)', async () => {
        body = { quests: makeQuests({
            source: 'blizzard', syncedAt: '2026-11-07T09:00:00.000Z', inProgressSyncedAt: null, inProgress: [],
            counts: { completedKnown: 2, knownTotal: 377, completedTotal: 120, inProgress: 0 },
        }) };
        await renderLoaded();
        expect(screen.getByText('2 completed · 377 known · via Armory · 7 Nov 2026 · 120 quests total')).toBeInTheDocument();
        expect(screen.queryByText(/via addon/)).not.toBeInTheDocument();
        expect(screen.getByText('No quests in progress')).toBeInTheDocument();
        expect(screen.getByText('The Deadmines · 1/6')).toBeInTheDocument();
    });

    it('lists in-progress quests with Forever Wowhead links and instance tag', async () => {
        await renderLoaded();
        expect(screen.getByRole('heading', { name: 'In progress (2)' })).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'The Defias Brotherhood on Wowhead' });
        expect(link.getAttribute('href')).toContain('/forever/quest=100');
        const row = screen.getByText('The Defias Brotherhood').closest('[data-quest-row]')!;
        expect(within(row as HTMLElement).getByText('Razorfen Downs')).toHaveClass('text-muted');
        expect(screen.getByText('Untracked Errand')).toBeInTheDocument();
    });

    it('marks done objectives success and open ones warning, with have/need', async () => {
        await renderLoaded();
        const done = screen.getByText('Edwin VanCleef slain').closest('li');
        expect(done).toHaveClass('text-success');
        expect(within(done!).getByText('done')).toHaveClass('sr-only');
        const open = screen.getByText('Red Silk Bandana').closest('li');
        expect(open).toHaveClass('text-warning');
        expect(within(open!).getByText('3/8')).toHaveClass('font-mono');
        expect(screen.getByText('Speak to Gryan').closest('li')?.textContent).not.toMatch(/\d\/\d/);
    });

    it('renders a quest with no objectives without a list', async () => {
        await renderLoaded();
        const row = screen.getByText('Untracked Errand').closest('[data-quest-row]');
        expect(row?.querySelector('ul')).toBeNull();
    });

    it('says "No quests in progress" for an empty log', async () => {
        body = { quests: makeQuests({ inProgress: [] }) };
        await renderLoaded();
        expect(screen.getByText('No quests in progress')).toBeInTheDocument();
    });
});

describe('CharacterQuestsSection — completed dungeon quests', () => {
    it('renders one collapsed group per instance titled "<Instance> · c/k"', async () => {
        await renderLoaded();
        const deadmines = screen.getByText('The Deadmines · 1/6').closest('details');
        const bfd = screen.getByText('Blackfathom Deeps · 1/8').closest('details');
        expect(deadmines).not.toHaveAttribute('open');
        expect(bfd).not.toHaveAttribute('open');
        expect(within(deadmines!).getByText('(Lv20)')).toBeInTheDocument();
    });

    it('shows the chain with done/needed step classes only when it has >1 step', async () => {
        await renderLoaded();
        const bfd = screen.getByText('Blackfathom Deeps · 1/8').closest('details')!;
        // Token colour on an inner span: the unlayered .quest-prereq__step rule would override it.
        const stepA = within(bfd).getByText('Step A');
        expect(stepA).toHaveClass('text-success');
        expect(stepA).not.toHaveClass('quest-prereq__step');
        expect(stepA.parentElement).toHaveClass('quest-prereq__step');
        expect(within(stepA.parentElement!).getByText('done')).toHaveClass('sr-only');
        const stepC = within(bfd).getByText('Step C');
        expect(stepC).toHaveClass('text-warning');
        expect(stepC).not.toHaveClass('quest-prereq__step');
        expect(within(stepC.parentElement!).getByText('not done')).toHaveClass('sr-only');
        const deadmines = screen.getByText('The Deadmines · 1/6').closest('details')!;
        expect(deadmines.querySelector('.quest-prereq')).toBeNull();
    });

    it('shows "0 of M known dungeon quests" when the overlap is empty', async () => {
        body = { quests: makeQuests({ completedKnown: [], counts: { completedKnown: 0, knownTotal: 377, completedTotal: 4, inProgress: 2 } }) };
        await renderLoaded();
        expect(screen.getByText('0 of 377 known dungeon quests')).toBeInTheDocument();
        expect(screen.queryByText(/ · \d+\/\d+$/)).toBeNull();
    });
});

/** ROK-2146 ruling 5: long lists show the first 5 rows + a "Show all N" / "Show fewer" toggle. */
describe('CharacterQuestsSection — 5-row caps', () => {
    const logEntry = (i: number) => ({ questId: 1000 + i, title: `Log quest ${i}`, dungeonInstanceId: null, instanceName: null, objectives: [] });
    const done = (i: number) => ({ questId: 2000 + i, name: `Done quest ${i}`, questLevel: 30, chain: [] });

    it('In progress with 7 quests shows 5 rows and a "Show all 7" toggle that expands and collapses', async () => {
        body = { quests: makeQuests({ inProgress: Array.from({ length: 7 }, (_, i) => logEntry(i)) }) };
        const { container } = renderSection();
        await screen.findByRole('heading', { name: 'Quests' });
        expect(container.querySelectorAll('[data-quest-row]'), 'capped to 5').toHaveLength(5);
        expect(screen.getByText('In progress (7)')).toBeInTheDocument();
        const toggle = screen.getByRole('button', { name: 'Show all 7' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(container.querySelectorAll('[data-quest-row]'), 'all rows after Show all').toHaveLength(7);
        const fewer = screen.getByRole('button', { name: 'Show fewer' });
        expect(fewer).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(fewer);
        expect(container.querySelectorAll('[data-quest-row]'), 'capped again after Show fewer').toHaveLength(5);
    });

    it('each completed group caps at 5 rows with its own toggle', async () => {
        const big = { dungeonInstanceId: 70, instanceName: 'Uldaman', knownCount: 12, completed: Array.from({ length: 8 }, (_, i) => done(i)) };
        body = { quests: makeQuests({ completedKnown: [big, ...makeQuests().completedKnown] }) };
        await renderLoaded();
        const group = screen.getByText('Uldaman · 8/12').closest('details');
        if (!group) throw new Error('Uldaman <details> group missing');
        expect(group.querySelectorAll('[data-completed-quest-row]'), 'capped to 5').toHaveLength(5);
        const toggle = within(group).getByRole('button', { name: 'Show all 8' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(group.querySelectorAll('[data-completed-quest-row]'), 'all rows after Show all').toHaveLength(8);
        expect(within(group).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('a list of 5 or fewer rows shows every row and no toggle', async () => {
        const five = { dungeonInstanceId: 70, instanceName: 'Uldaman', knownCount: 12, completed: Array.from({ length: 5 }, (_, i) => done(i)) };
        body = { quests: makeQuests({ inProgress: Array.from({ length: 5 }, (_, i) => logEntry(i)), completedKnown: [five] }) };
        const { container } = renderSection();
        await screen.findByRole('heading', { name: 'Quests' });
        expect(container.querySelectorAll('[data-quest-row]')).toHaveLength(5);
        expect(container.querySelectorAll('[data-completed-quest-row]')).toHaveLength(5);
        expect(screen.queryByRole('button', { name: /^Show (all|fewer)/ })).toBeNull();
    });
});
