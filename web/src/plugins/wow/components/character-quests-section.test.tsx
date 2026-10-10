/**
 * ROK-1745: quest tracking section on the WoW: Forever character page —
 * hidden states, summary line, quest log objectives and completed groups.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
                questId: 100, title: 'The Defias Brotherhood', dungeonInstanceId: 63,
                objectives: [
                    { text: 'Edwin VanCleef slain', done: true, have: 1, need: 1 },
                    { text: 'Red Silk Bandana', done: false, have: 3, need: 8 },
                    { text: 'Speak to Gryan', done: false, have: null, need: null },
                ],
            },
            { questId: 92472, title: 'Untracked Errand', dungeonInstanceId: null, objectives: [] },
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
    it('shows counts, source, date and the total completed', async () => {
        await renderLoaded();
        expect(screen.getByText('2 completed · 377 known · via addon · 1 Oct 2026 · 120 quests total')).toBeInTheDocument();
    });

    it('lists in-progress quests with Forever Wowhead links and instance tag', async () => {
        await renderLoaded();
        expect(screen.getByRole('heading', { name: 'In progress (2)' })).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'The Defias Brotherhood on Wowhead' });
        expect(link.getAttribute('href')).toContain('/forever/quest=100');
        expect(screen.getAllByText('The Deadmines').length).toBeGreaterThan(0);
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
        expect(within(bfd).getByText('Step A')).toHaveClass('quest-prereq__step', 'text-success');
        expect(within(bfd).getByText('Step C')).toHaveClass('quest-prereq__step', 'text-warning');
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
