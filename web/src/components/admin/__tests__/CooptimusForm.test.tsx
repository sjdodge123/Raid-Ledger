/**
 * CooptimusForm tests (ROK-1397): save round-trip, honest test-connection
 * failure banner, clear, and the empty-input guard. ROK-1652 (E4): the prose
 * opt-in is the shared Checkbox named by its visible label, the triad is
 * Button primary/secondary/destructive-soft with `loading`, and no brand hex.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { CooptimusForm } from '../CooptimusForm';

const updateAsync = vi.fn();
const testAsync = vi.fn();
const clearAsync = vi.fn();
const proseAsync = vi.fn();
let configured = false;
let proseEnabled = false;
const pending = { save: false, test: false, clear: false, prose: false };
vi.mock('../../../hooks/admin/use-cooptimus-settings', () => ({
    useCooptimusSettings: () => ({
        cooptimusStatus: { data: { configured, proseEnabled }, isLoading: false },
        updateCooptimus: { mutateAsync: updateAsync, isPending: pending.save },
        setCooptimusProse: { mutateAsync: proseAsync, isPending: pending.prose },
        testCooptimus: { mutateAsync: testAsync, isPending: pending.test },
        clearCooptimus: { mutateAsync: clearAsync, isPending: pending.clear },
    }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../../lib/toast', () => ({
    toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

function resetState() {
    vi.clearAllMocks();
    configured = false;
    proseEnabled = false;
    Object.assign(pending, { save: false, test: false, clear: false, prose: false });
}

/** Ruling 12: the prose opt-in is named by its visible label alone. */
const proseCheckbox = () => screen.getByRole('checkbox', { name: 'Show editorial prose' });

/**
 * ROK-1652 ruling 7: a pending button is Button `loading` — aria-disabled +
 * aria-busy (focus stays) and it swallows clicks. Each case below also clicks
 * the button and proves the mutation never fires.
 */
function expectLoading(btn: HTMLElement) {
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
}

// ROK-1398: the prose opt-in defaults OFF — the Co-Optimus grant covers the
// co-op facts, not their editorial prose.
describe('CooptimusForm — prose Checkbox', () => {
    beforeEach(resetState);

    it('renders the prose checkbox unchecked by default and enables it on click', async () => {
        proseAsync.mockResolvedValue({ success: true, message: 'prose on' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        expect(proseCheckbox()).not.toBeChecked();
        await user.click(proseCheckbox());

        await waitFor(() => expect(proseAsync).toHaveBeenCalledWith({ enabled: true }));
        expect(toastSuccess).toHaveBeenCalledWith('prose on');
    });

    it('reflects the stored flag and toggles it off on click', async () => {
        proseEnabled = true;
        proseAsync.mockResolvedValue({ success: true, message: 'prose off' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        expect(proseCheckbox()).toBeChecked();
        await user.click(proseCheckbox());

        await waitFor(() => expect(proseAsync).toHaveBeenCalledWith({ enabled: false }));
    });

    it('links the prose explanation as the checkbox description', () => {
        renderWithProviders(<CooptimusForm />);
        expect(proseCheckbox()).toHaveAccessibleDescription(/The Co-Op Experience/);
    });
});

describe('CooptimusForm — user-agent save', () => {
    beforeEach(resetState);

    it('keeps the #cooptimus-ua id on the labelled input (smoke contract)', () => {
        renderWithProviders(<CooptimusForm />);
        expect(screen.getByRole('textbox', { name: 'Allowlisted user-agent' })).toHaveAttribute('id', 'cooptimus-ua');
    });

    it('saves a trimmed user-agent and clears the input', async () => {
        updateAsync.mockResolvedValue({ success: true, message: 'saved' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.type(screen.getByLabelText(/allowlisted user-agent/i), '  RaidLedger/1.0  ');
        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() =>
            expect(updateAsync).toHaveBeenCalledWith({ userAgent: 'RaidLedger/1.0' }),
        );
        expect(toastSuccess).toHaveBeenCalledWith('saved');
        expect(screen.getByLabelText(/allowlisted user-agent/i)).toHaveValue('');
    });

    it('blocks empty submits client-side', async () => {
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        expect(updateAsync).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalledWith('User-agent is required');
    });

    it('lays Save out like the shared integration triad: a full-width row below lg', () => {
        renderWithProviders(<CooptimusForm />);
        const save = screen.getByRole('button', { name: 'Save' });
        expect(save).toHaveClass('w-full', 'lg:w-auto', 'lg:flex-1');
    });

    it('Save is loading and swallows the submit when save is pending', () => {
        pending.save = true;
        renderWithProviders(<CooptimusForm />);
        fireEvent.change(screen.getByLabelText(/allowlisted user-agent/i), { target: { value: 'RL/1.0' } });
        const btn = screen.getByRole('button', { name: 'Saving…' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(updateAsync).not.toHaveBeenCalled();
    });
});

describe('CooptimusForm — Test and Clear', () => {
    beforeEach(resetState);

    it('hides Test/Clear until configured; shows the honest 403 banner on test failure', async () => {
        expect(renderWithProviders(<CooptimusForm />).container).toBeTruthy();
        expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument();

        configured = true;
        testAsync.mockResolvedValue({
            success: false,
            message: 'HTTP 403 — the user-agent is not allowlisted past the Cloudflare challenge',
        });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);
        await user.click(screen.getAllByRole('button', { name: /test connection/i })[0]);

        await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeInTheDocument());
        expect(toastError).toHaveBeenCalled();
    });

    it('clear calls the mutation and toasts', async () => {
        configured = true;
        clearAsync.mockResolvedValue({ success: true, message: 'cleared' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.click(screen.getByRole('button', { name: /^Clear$/i }));

        await waitFor(() => expect(clearAsync).toHaveBeenCalled());
        expect(toastSuccess).toHaveBeenCalledWith('cleared');
    });

    it('Test is loading and swallows the click when test is pending', () => {
        configured = true;
        pending.test = true;
        renderWithProviders(<CooptimusForm />);
        const btn = screen.getByRole('button', { name: 'Testing…' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(testAsync).not.toHaveBeenCalled();
    });

    it('Clear is loading and swallows the click when clear is pending', () => {
        configured = true;
        pending.clear = true;
        renderWithProviders(<CooptimusForm />);
        const btn = screen.getByRole('button', { name: 'Clearing…' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(clearAsync).not.toHaveBeenCalled();
    });
});

describe('CooptimusForm — theme tokens', () => {
    beforeEach(resetState);

    it('renders the setup callout as the neutral panel', () => {
        renderWithProviders(<CooptimusForm />);
        const panel = screen.getByText('Permission-first setup:').closest('div');
        expect(panel).toHaveClass('bg-overlay/30', 'border-edge');
    });

    it('uses no raw hex colour classes (brand blue retired)', () => {
        configured = true;
        const { container } = renderWithProviders(<CooptimusForm />);
        expect(container.innerHTML).not.toMatch(/\[#[0-9a-f]{3,8}\]/i);
    });
});
