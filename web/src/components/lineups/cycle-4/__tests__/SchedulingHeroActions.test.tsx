/**
 * ROK-1582 — the three scheduling hero actions share ONE mobile-first recipe.
 *
 * The operator's phone screenshot showed Add Participants / Remind Voters /
 * Cancel Poll stacked one-per-line as 10px uppercase outline pills (~22px
 * tall) hanging past the hero card's right edge. They now all carry
 * `SCHEDULING_ACTION_BUTTON_BASE` (44px phone target, 36px from `sm`,
 * normal-case `text-sm`) and their accessible names are unchanged.
 *
 * jsdom has no layout, so the assertions are on class names — the Playwright
 * case in `scheduling-poll.smoke.spec.ts` measures the real boxes.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingAddMembersAction } from '../SchedulingAddMembersAction';
import { SchedulingRemindAction } from '../SchedulingRemindAction';
import { SchedulingCancelAction } from '../SchedulingCancelAction';
import {
    SCHEDULING_ACTION_BUTTON,
    SCHEDULING_ACTION_BUTTON_BASE,
    SCHEDULING_ACTION_BUTTON_DANGER,
} from '../scheduling-action-button';

vi.mock('react-router-dom', async () => {
    const actual =
        await vi.importActual<typeof import('react-router-dom')>(
            'react-router-dom',
        );
    return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../../hooks/use-scheduling', () => ({
    useAddPollMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRemindVoters: () => ({
        mutate: vi.fn(),
        isPending: false,
        isSuccess: false,
        reset: vi.fn(),
    }),
    useCancelSchedulePoll: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 10, role: 'operator' } }),
    isOperatorOrAdmin: () => true,
}));

const match = { lineupCreatedById: 10 } as MatchDetailResponseDto;

function renderActions(): void {
    renderWithProviders(
        <>
            <SchedulingAddMembersAction
                lineupId={5}
                matchId={9}
                match={match}
                readOnly={false}
            />
            <SchedulingRemindAction
                lineupId={5}
                matchId={9}
                match={match}
                readOnly={false}
            />
            <SchedulingCancelAction lineupId={5} matchId={9} readOnly={false} />
        </>,
    );
}

/** Every class in `recipe` is present on the element. */
function expectRecipe(el: HTMLElement, recipe: string): void {
    const classes = Array.from(el.classList);
    for (const cls of recipe.split(/\s+/).filter(Boolean)) {
        expect(classes).toContain(cls);
    }
}

describe('Scheduling hero actions — one mobile-safe recipe (ROK-1582)', () => {
    it('all three buttons carry the shared 44px recipe', () => {
        renderActions();
        const buttons = [
            screen.getByTestId('add-poll-members-button'),
            screen.getByRole('button', { name: /Remind Voters/i }),
            screen.getByRole('button', { name: /Cancel Poll/i }),
        ];
        for (const btn of buttons) expectRecipe(btn, SCHEDULING_ACTION_BUTTON_BASE);
    });

    it('uses the neutral recipe for Add/Remind and the danger one for Cancel', () => {
        renderActions();
        expectRecipe(
            screen.getByTestId('add-poll-members-button'),
            SCHEDULING_ACTION_BUTTON,
        );
        expectRecipe(
            screen.getByRole('button', { name: /Remind Voters/i }),
            SCHEDULING_ACTION_BUTTON,
        );
        expectRecipe(
            screen.getByRole('button', { name: /Cancel Poll/i }),
            SCHEDULING_ACTION_BUTTON_DANGER,
        );
    });

    it('leaves no 10px uppercase pill styling behind', () => {
        renderActions();
        const buttons = [
            screen.getByTestId('add-poll-members-button'),
            screen.getByRole('button', { name: /Remind Voters/i }),
            screen.getByRole('button', { name: /Cancel Poll/i }),
        ];
        for (const btn of buttons) {
            const classes = Array.from(btn.classList);
            expect(classes).not.toContain('text-[10px]');
            expect(classes).not.toContain('uppercase');
            expect(classes).not.toContain('py-0.5');
        }
    });
});
