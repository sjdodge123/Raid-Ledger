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
    // Review MAJOR-2: the element checks below split the SAME constant the
    // component applies, so they cannot catch a value edited out of the
    // recipe. These literals pin what the ACs actually require.
    it('the recipe itself pins the phone target and the desktop height', () => {
        expect(SCHEDULING_ACTION_BUTTON_BASE).toContain('min-h-[44px]');
        expect(SCHEDULING_ACTION_BUTTON_BASE).toContain('lg:min-h-[36px]');
        // 38px otherwise: py-2 + 20px text-sm line + 2px border (ROK-1585).
        expect(SCHEDULING_ACTION_BUTTON_BASE).toContain('lg:py-1.5');
        expect(SCHEDULING_ACTION_BUTTON_BASE).toContain('text-sm');
        expect(SCHEDULING_ACTION_BUTTON_BASE).toContain('flex-1');
        expect(SCHEDULING_ACTION_BUTTON_BASE).not.toMatch(/text-\[10px\]|uppercase/);
        expect(SCHEDULING_ACTION_BUTTON).toContain('border-edge-strong');
        expect(SCHEDULING_ACTION_BUTTON_DANGER).toContain('text-red-400');
    });

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
