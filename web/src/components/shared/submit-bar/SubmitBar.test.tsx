/**
 * Failing-first tests for SubmitBar component (ROK-1296 / U4).
 *
 * Source file does not yet exist — these MUST fail with module-not-found
 * until the dev implements `web/src/components/shared/submit-bar/SubmitBar.tsx`.
 *
 * Covered ACs (from planning-artifacts/specs/ROK-1296.md):
 *   - AC1a/b/c/d — visual states for each of the 4 kinds
 *     (empty / partial / pre / post).
 *   - AC7 — a11y: every CTA <button> has an aria-label, including the
 *     disabled state (the label must explain the disabled reason).
 *
 * Props contract (mirrors the wireframe mock in
 * `web/src/dev/simplify-wireframes/simplify-composite-mocks.tsx:70-89`):
 *   kind: 'empty' | 'partial' | 'pre' | 'post'
 *   status: string                 // left-side status copy
 *   cta: string                    // button label
 *   nudge?: string                 // small italic line (partial only)
 *   onCtaClick?: () => void        // fired on click for pre/partial/post
 *   disabledReason?: string        // optional override for the disabled aria-label
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { SubmitBar } from './SubmitBar';

describe('SubmitBar — kind=empty (AC1a)', () => {
    it('renders the CTA as a disabled button', () => {
        renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 of 3 votes used · vote on a game"
                cta="Submit (disabled)"
            />,
        );
        const btn = screen.getByRole('button', { name: /submit/i });
        expect(btn).toBeDisabled();
    });

    it('renders the ⊘ prefix in the status row', () => {
        const { container } = renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 nominations · add a game first"
                cta="Submit (disabled)"
            />,
        );
        expect(container.textContent).toContain('⊘');
    });

    it('does NOT render a nudge line even if one is passed', () => {
        renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 of 3 votes used"
                cta="Submit (disabled)"
                nudge="You should never see this on empty."
            />,
        );
        expect(
            screen.queryByText(/You should never see this on empty\./),
        ).not.toBeInTheDocument();
    });
});

describe('SubmitBar — kind=partial (AC1b)', () => {
    it('renders the CTA as an enabled button', () => {
        renderWithProviders(
            <SubmitBar
                kind="partial"
                status="1 of 3 votes used · autosaved"
                cta="Submit (1 of 3) →"
                onCtaClick={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: /Submit \(1 of 3\)/ });
        expect(btn).not.toBeDisabled();
    });

    it('renders the nudge line when provided', () => {
        renderWithProviders(
            <SubmitBar
                kind="partial"
                status="1 of 3 votes used · autosaved"
                cta="Submit (1 of 3) →"
                nudge="You have 2 votes left — use them or submit early."
                onCtaClick={() => {}}
            />,
        );
        expect(
            screen.getByText(
                /You have 2 votes left — use them or submit early\./,
            ),
        ).toBeInTheDocument();
    });

    it('omits the nudge line when not provided', () => {
        renderWithProviders(
            <SubmitBar
                kind="partial"
                status="1 of 3 votes used · autosaved"
                cta="Submit (1 of 3) →"
                onCtaClick={() => {}}
            />,
        );
        // Nudges are italic; no italic <div> should render.
        expect(screen.queryByText(/votes left/)).not.toBeInTheDocument();
    });
});

describe('SubmitBar — kind=pre (AC1c)', () => {
    it('renders the CTA as an enabled primary button', () => {
        renderWithProviders(
            <SubmitBar
                kind="pre"
                status="3 of 3 votes used · autosaved"
                cta="Submit my votes →"
                onCtaClick={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: /Submit my votes/ });
        expect(btn).not.toBeDisabled();
    });

    it('does NOT render the ⊘ / ✓ prefix in the status row', () => {
        const { container } = renderWithProviders(
            <SubmitBar
                kind="pre"
                status="3 of 3 votes used · autosaved"
                cta="Submit my votes →"
                onCtaClick={() => {}}
            />,
        );
        expect(container.textContent).not.toContain('⊘');
        expect(container.textContent).not.toContain('✓');
    });
});

describe('SubmitBar — kind=post (AC1d)', () => {
    it('renders the ✓ prefix in the status row', () => {
        const { container } = renderWithProviders(
            <SubmitBar
                kind="post"
                status="Submitted Thu 7:15 PM · 14 of 20 have submitted"
                cta="Change my votes"
                onCtaClick={() => {}}
            />,
        );
        expect(container.textContent).toContain('✓');
    });

    it('renders the CTA as an enabled (ghost) button', () => {
        renderWithProviders(
            <SubmitBar
                kind="post"
                status="Submitted Thu 7:15 PM · 14 of 20 have submitted"
                cta="Change my votes"
                onCtaClick={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: /Change my votes/ });
        expect(btn).not.toBeDisabled();
    });
});

describe('SubmitBar — a11y (AC7)', () => {
    it('disabled CTA has an aria-label that communicates the disabled reason', () => {
        renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 of 3 votes used · vote on a game"
                cta="Submit (disabled)"
                disabledReason="vote on a game first"
            />,
        );
        // Match any button whose accessible name contains both "Submit" and
        // the explanatory reason. The dev is free to use the exact spec copy
        // ("Submit (disabled — vote on a game first)") or compose it from
        // the disabledReason prop — either satisfies the AC.
        const btn = screen.getByRole('button', {
            name: /Submit.*vote on a game first/i,
        });
        expect(btn).toBeDisabled();
    });

    it('disabled CTA still has an aria-label even when disabledReason is omitted', () => {
        renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 of 3 votes used"
                cta="Submit (disabled)"
            />,
        );
        // Whatever the fallback copy is, the button MUST have an accessible
        // name — no `button "(no name)"`.
        const btn = screen.getByRole('button');
        const label =
            btn.getAttribute('aria-label') ?? btn.textContent?.trim() ?? '';
        expect(label.length).toBeGreaterThan(0);
    });

    it('enabled CTA has an aria-label matching its visible text', () => {
        renderWithProviders(
            <SubmitBar
                kind="pre"
                status="3 of 3 votes used · autosaved"
                cta="Submit my votes →"
                onCtaClick={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: /Submit my votes/ });
        // Either aria-label or text content must satisfy the role-name query.
        // The query itself succeeding is the assertion; the explicit expect
        // just pins intent.
        expect(btn).toBeInTheDocument();
    });
});

describe('SubmitBar — onCtaClick wiring', () => {
    it('fires onCtaClick when kind=pre', async () => {
        const onCtaClick = vi.fn();
        renderWithProviders(
            <SubmitBar
                kind="pre"
                status="3 of 3 votes used"
                cta="Submit my votes →"
                onCtaClick={onCtaClick}
            />,
        );
        await userEvent.click(
            screen.getByRole('button', { name: /Submit my votes/ }),
        );
        expect(onCtaClick).toHaveBeenCalledTimes(1);
    });

    it('fires onCtaClick when kind=partial', async () => {
        const onCtaClick = vi.fn();
        renderWithProviders(
            <SubmitBar
                kind="partial"
                status="1 of 3 votes used"
                cta="Submit (1 of 3) →"
                onCtaClick={onCtaClick}
            />,
        );
        await userEvent.click(
            screen.getByRole('button', { name: /Submit \(1 of 3\)/ }),
        );
        expect(onCtaClick).toHaveBeenCalledTimes(1);
    });

    it('fires onCtaClick when kind=post', async () => {
        const onCtaClick = vi.fn();
        renderWithProviders(
            <SubmitBar
                kind="post"
                status="Submitted Thu 7:15 PM"
                cta="Change my votes"
                onCtaClick={onCtaClick}
            />,
        );
        await userEvent.click(
            screen.getByRole('button', { name: /Change my votes/ }),
        );
        expect(onCtaClick).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onCtaClick when kind=empty (button is disabled)', async () => {
        const onCtaClick = vi.fn();
        renderWithProviders(
            <SubmitBar
                kind="empty"
                status="0 of 3 votes used"
                cta="Submit (disabled)"
                onCtaClick={onCtaClick}
            />,
        );
        const btn = screen.getByRole('button', { name: /submit/i });
        // userEvent respects `disabled` and is a no-op on disabled buttons.
        await userEvent.click(btn);
        expect(onCtaClick).not.toHaveBeenCalled();
    });
});
