/** ROK-1701 OQ-8b: the cloud flavour skips the "Secure Account" wizard step; NAS is unchanged. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminSetupWizard } from './admin-setup-wizard';

vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn(), isAdmin: vi.fn() }));
vi.mock('../../hooks/use-onboarding', () => ({ useOnboarding: vi.fn() }));
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { info: vi.fn() } }));
vi.mock('../../components/admin/onboarding/secure-account-step', () => ({
    SecureAccountStep: () => <div data-testid="secure-account-step" />,
}));
vi.mock('../../components/admin/onboarding/community-identity-step', () => ({
    CommunityIdentityStep: ({ onBack }: { onBack: () => void }) => (
        <div data-testid="community-identity-step"><button onClick={onBack}>Back</button></div>
    ),
}));
vi.mock('../../components/admin/onboarding/connect-plugins-step', () => ({
    ConnectPluginsStep: () => <div data-testid="connect-plugins-step" />,
}));
vi.mock('../../components/admin/onboarding/done-step', () => ({
    DoneStep: ({ firstStep }: { firstStep?: number }) => <div data-testid="done-step" data-first-step={firstStep} />,
}));

import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useOnboarding } from '../../hooks/use-onboarding';
import { useSystemStatus } from '../../hooks/use-system-status';

const updateMutate = vi.fn();

function setup(flavour: 'cloud' | 'nas' | undefined, currentStep = 0): void {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(isAdmin).mockReturnValue(true);
    vi.mocked(useSystemStatus).mockReturnValue({ data: { flavour } } as unknown as ReturnType<typeof useSystemStatus>);
    vi.mocked(useOnboarding).mockReturnValue({
        statusQuery: { isLoading: false, data: { currentStep, completed: false, steps: {} } },
        updateStep: { mutate: updateMutate },
        completeOnboarding: { mutate: vi.fn(), isPending: false },
    } as unknown as ReturnType<typeof useOnboarding>);
    render(
        <MemoryRouter initialEntries={['/admin/setup']}>
            <Routes><Route path="/admin/setup" element={<AdminSetupWizard />} /></Routes>
        </MemoryRouter>,
    );
}

describe('AdminSetupWizard — flavour (ROK-1701 OQ-8b)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('cloud: starts at Community when the server step is 0 and hides Secure Account', () => {
        setup('cloud', 0);
        expect(screen.getByTestId('community-identity-step')).toBeInTheDocument();
        expect(screen.queryByTestId('secure-account-step')).not.toBeInTheDocument();
        expect(screen.queryByText('Secure Account')).not.toBeInTheDocument();
        expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('cloud: Back from Community never returns to the hidden step', () => {
        setup('cloud', 0);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(updateMutate).not.toHaveBeenCalled();
        expect(screen.getByTestId('community-identity-step')).toBeInTheDocument();
    });

    it('cloud: server step numbers are not renumbered', () => {
        setup('cloud', 2);
        expect(screen.getByTestId('connect-plugins-step')).toBeInTheDocument();
        expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    });

    it.each([['cloud' as const, '1'], ['nas' as const, '0']])('%s: Done step is told the first visible step', (flavour, first) => {
        setup(flavour, 3);
        expect(screen.getByTestId('done-step')).toHaveAttribute('data-first-step', first);
    });

    it.each([['nas' as const], [undefined]])('%s: keeps Secure Account as step 1 of 4', (flavour) => {
        setup(flavour, 0);
        expect(screen.getByTestId('secure-account-step')).toBeInTheDocument();
        expect(screen.getAllByText('Secure Account').length).toBeGreaterThan(0);
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    });
});
