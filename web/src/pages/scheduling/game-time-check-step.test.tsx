import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { StepOneDoneContext, useStepOneDone } from './game-time-check-step';

function StepOneBody(): JSX.Element {
    const done = useStepOneDone();
    return <button type="button" onClick={done}>Done</button>;
}

describe('useStepOneDone — the step-1 seam', () => {
    it('is a harmless no-op outside the sheet (the desktop modal renders the same body)', async () => {
        render(<StepOneBody />);
        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('calls the shell-provided advance when a body reports done inside the sheet', async () => {
        const advance = vi.fn();
        render(
            <StepOneDoneContext.Provider value={advance}>
                <StepOneBody />
            </StepOneDoneContext.Provider>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(advance).toHaveBeenCalledTimes(1);
    });
});
