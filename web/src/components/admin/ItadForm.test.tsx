import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItadForm } from './ItadForm';

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Shared mutable state for the hook mock
const mockItadStatus = {
    data: null as null | { configured: boolean },
};

const mockUpdateItad = { mutateAsync: vi.fn(), isPending: false };
const mockTestItad = { mutateAsync: vi.fn(), isPending: false };
const mockClearItad = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../hooks/admin/use-itad-settings', () => ({
    useItadSettings: () => ({
        itadStatus: mockItadStatus,
        updateItad: mockUpdateItad,
        testItad: mockTestItad,
        clearItad: mockClearItad,
    }),
}));

function resetMocks() {
    vi.clearAllMocks();
    mockItadStatus.data = null;
    mockUpdateItad.isPending = false;
    mockUpdateItad.mutateAsync = vi.fn();
    mockTestItad.isPending = false;
    mockTestItad.mutateAsync = vi.fn();
    mockClearItad.isPending = false;
    mockClearItad.mutateAsync = vi.fn();
}

describe('ItadForm', () => {
    beforeEach(resetMocks);

    // -- Setup instructions ------------------------------------------------

    it('renders setup instructions', () => {
        render(<ItadForm />);
        expect(screen.getByText(/Setup Instructions/)).toBeInTheDocument();
    });

    it('renders ITAD developer portal link', () => {
        render(<ItadForm />);
        const link = screen.getByRole('link', {
            name: /isthereanydeal\.com/,
        });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute(
            'href',
            'https://isthereanydeal.com/dev/app/',
        );
    });

    // -- API key input -----------------------------------------------------

    it('renders API key input field', () => {
        render(<ItadForm />);
        expect(screen.getByLabelText('ITAD API Key')).toBeInTheDocument();
    });

    it('API key input is type=password by default', () => {
        render(<ItadForm />);
        const input = screen.getByLabelText('ITAD API Key');
        expect(input).toHaveAttribute('type', 'password');
    });

    it('toggles API key visibility when eye button is clicked', () => {
        render(<ItadForm />);
        const input = screen.getByLabelText(
            'ITAD API Key',
        ) as HTMLInputElement;
        expect(input.type).toBe('password');

        const toggleBtn = screen.getByRole('button', {
            name: 'Show API key',
        });
        fireEvent.click(toggleBtn);
        expect(input.type).toBe('text');
    });

    // -- Save Configuration button -----------------------------------------

    it('shows Save Configuration button', () => {
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Save Configuration' }),
        ).toBeInTheDocument();
    });

    it('Save Configuration button is disabled when save is pending', () => {
        mockUpdateItad.isPending = true;
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Saving...' }),
        ).toBeDisabled();
    });

    // -- Configured state: Test Connection and Clear -----------------------

    it('shows Test Connection button when configured', () => {
        mockItadStatus.data = { configured: true };
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Test Connection' }),
        ).toBeInTheDocument();
    });

    it('shows Clear button when configured', () => {
        mockItadStatus.data = { configured: true };
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Clear' }),
        ).toBeInTheDocument();
    });

    it('Test Connection button is disabled when test is pending', () => {
        mockItadStatus.data = { configured: true };
        mockTestItad.isPending = true;
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Testing...' }),
        ).toBeDisabled();
    });

    // -- Unconfigured state ------------------------------------------------

    it('hides Test Connection button when not configured', () => {
        mockItadStatus.data = { configured: false };
        render(<ItadForm />);
        expect(
            screen.queryByRole('button', { name: 'Test Connection' }),
        ).not.toBeInTheDocument();
    });

    it('hides Clear button when not configured', () => {
        mockItadStatus.data = { configured: false };
        render(<ItadForm />);
        expect(
            screen.queryByRole('button', { name: 'Clear' }),
        ).not.toBeInTheDocument();
    });

    it('hides Test Connection and Clear when status data is null', () => {
        mockItadStatus.data = null;
        render(<ItadForm />);
        expect(
            screen.queryByRole('button', { name: 'Test Connection' }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Clear' }),
        ).not.toBeInTheDocument();
    });
});
