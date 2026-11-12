/**
 * ROK-1927 (§5.3 own view, mockup F7) — the Attunements block on the character
 * page Quests section: step checklist kinds, state chip, below-level note, the
 * unverified sentence for `[]`, and the section hiding it when the key is absent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, render, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CharacterQuestsDto, CharacterQuestsResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildCharacterAttunement } from '../../../test/factories/forever-attunements';
import { CharacterAttunements } from './character-attunements';
import { attunementRowTitle, attunementStepViews } from './character-attunements.helpers';
import { CharacterQuestsSection } from './character-quests-section';

const SOURCE = 'via Armory · 9 Nov 2026';

function rowOf(instance: string): HTMLElement {
    const summary = screen.getByText(new RegExp(`^${instance} — `));
    const row = summary.closest<HTMLElement>('[data-testid="character-attunement"]');
    if (row === null) throw new Error(`no attunement row for ${instance}`);
    return row;
}

describe('attunement own-view helpers', () => {
    it('titles the row with done of total steps', () => {
        expect(attunementRowTitle(buildCharacterAttunement())).toBe("Onyxia's Lair — 4 of 7 steps");
    });

    it('marks done steps, exactly one next step, then the rest', () => {
        const kinds = attunementStepViews(buildCharacterAttunement()).map((s) => s.kind);
        expect(kinds).toEqual(['done', 'done', 'done', 'done', 'next', 'rest', 'rest']);
    });

    it('has no next step once attuned or without data', () => {
        const noData = buildCharacterAttunement({ state: 'no_data', nextStep: null, steps: [{ label: 'a', done: false }] });
        expect(attunementStepViews(noData).map((s) => s.kind)).toEqual(['rest']);
    });
});

describe('CharacterAttunements', () => {
    it('renders the checklist: done ✓ success, the next step bold with a Next chip, the rest muted', () => {
        render(<CharacterAttunements attunements={[buildCharacterAttunement()]} level={60} sourceLine={SOURCE} />);
        const row = rowOf("Onyxia's Lair");
        expect(row).toHaveAttribute('data-state', 'in_progress');
        expect(row.querySelector('details')).toHaveAttribute('open');
        const steps = within(row).getByRole('list', { name: "Onyxia's Lair steps" });
        const done = within(steps).getByText("Warlord's Command").closest('li');
        expect(done).toHaveAttribute('data-step', 'done');
        expect(done).toHaveClass('text-success');
        const next = within(steps).getByText('What the Wind Carries').closest('li');
        expect(next).toHaveAttribute('data-step', 'next');
        expect(next).toHaveClass('font-medium', 'text-foreground');
        expect(within(next ?? steps).getByText('Next')).toHaveAttribute('data-tone', 'warning');
        expect(within(steps).getByText('Oculus Illusions').closest('li')).toHaveClass('text-muted');
        expect(within(row).getByText('In progress')).toHaveAttribute('data-tone', 'warning');
        expect(screen.getByText(SOURCE)).toHaveClass('text-dim');
    });

    it('keeps an attuned chain collapsed with the Attuned chip', () => {
        const mc = buildCharacterAttunement({
            key: 'mc-horde', groupKey: 'mc', instance: 'Molten Core', state: 'done', nextStep: null,
            steps: [{ label: 'Attunement to the Core', done: true }],
        });
        render(<CharacterAttunements attunements={[mc]} level={60} sourceLine={SOURCE} />);
        const row = rowOf('Molten Core');
        expect(row.querySelector('details')).not.toHaveAttribute('open');
        expect(within(row).getByText('Attuned')).toHaveAttribute('data-tone', 'success');
        expect(within(row).getByText('Molten Core — 1 of 1 steps')).toBeInTheDocument();
    });

    it('shows "Level 52 — needs 55" under a below-level chain only', () => {
        const below = buildCharacterAttunement({ belowLevel: true, requiredLevel: 55 });
        const fine = buildCharacterAttunement({ key: 'bwl', groupKey: 'bwl', instance: 'Blackwing Lair', requiredLevel: 55 });
        render(<CharacterAttunements attunements={[below, fine]} level={52} sourceLine={SOURCE} />);
        expect(within(rowOf("Onyxia's Lair")).getByTestId('character-attunement-level')).toHaveTextContent('Level 52 — needs 55');
        expect(within(rowOf('Blackwing Lair')).queryByTestId('character-attunement-level')).toBeNull();
    });

    it("says the data isn't verified yet when nothing is confirmed", () => {
        render(<CharacterAttunements attunements={[]} level={60} sourceLine={SOURCE} />);
        expect(screen.getByRole('heading', { name: 'Attunements' })).toBeInTheDocument();
        expect(screen.getByText("Attunement data for Forever isn't verified yet.")).toBeInTheDocument();
        expect(screen.queryByTestId('character-attunement')).toBeNull();
    });
});

describe('CharacterQuestsSection — Attunements block', () => {
    const CHAR_ID = '11111111-1111-4111-8111-111111111111';
    const URL = `http://localhost:3000/plugins/wow/characters/${CHAR_ID}/quests`;
    let body: CharacterQuestsResponse;

    function quests(overrides: Partial<CharacterQuestsDto> = {}): CharacterQuestsDto {
        return {
            source: 'blizzard', syncedAt: '2026-11-09T12:00:00.000Z', inProgressSyncedAt: null, inProgress: [], completedKnown: [],
            counts: { completedKnown: 0, knownTotal: 377, completedTotal: 10, inProgress: 0 }, ...overrides,
        };
    }

    beforeEach(() => {
        server.use(http.get(URL, () => HttpResponse.json(body)));
    });

    it('renders no Attunements block when the api omits the key', async () => {
        body = { quests: quests() };
        renderWithProviders(<CharacterQuestsSection characterId={CHAR_ID} variant="wow_forever" level={52} />);
        await screen.findByRole('heading', { name: 'Quests' });
        expect(screen.queryByRole('heading', { name: 'Attunements' })).toBeNull();
    });

    it('renders the checklists with the character level in the note', async () => {
        body = { quests: quests({ attunements: [buildCharacterAttunement({ belowLevel: true, requiredLevel: 55 })] }) };
        renderWithProviders(<CharacterQuestsSection characterId={CHAR_ID} variant="wow_forever" level={52} />);
        await screen.findByRole('heading', { name: 'Attunements' });
        expect(screen.getByTestId('character-attunement-level')).toHaveTextContent('Level 52 — needs 55');
        expect(screen.getByText('via Armory · 9 Nov 2026')).toBeInTheDocument();
    });
});
