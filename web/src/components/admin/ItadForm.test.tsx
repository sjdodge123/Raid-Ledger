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

/**
 * ROK-1652 ruling 7: a pending button is Button `loading` — aria-disabled +
 * aria-busy (focus stays), and it swallows clicks. Listed in the PR as the
 * equivalent of the old native toBeDisabled(), not a weakening: each case
 * below also clicks the button and proves the mutation never fires.
 */
function expectLoading(btn: HTMLElement) {
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
}

describe('ItadForm — setup instructions and API key', () => {
    beforeEach(resetMocks);

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

    it('renders API key input field', () => {
        render(<ItadForm />);
        expect(screen.getByLabelText('ITAD API Key')).toBeInTheDocument();
    });

    it('keeps the #itadApiKey id the smoke spec targets', () => {
        render(<ItadForm />);
        expect(screen.getByLabelText('ITAD API Key')).toHaveAttribute('id', 'itadApiKey');
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
});

describe('ItadForm — Save Configuration', () => {
    beforeEach(resetMocks);

    it('shows Save Configuration button', () => {
        render(<ItadForm />);
        expect(
            screen.getByRole('button', { name: 'Save Configuration' }),
        ).toBeInTheDocument();
    });

    it('Save Configuration button is loading and swallows the submit when save is pending', () => {
        mockUpdateItad.isPending = true;
        render(<ItadForm />);
        fireEvent.change(screen.getByLabelText('ITAD API Key'), { target: { value: 'itad-key' } });
        const btn = screen.getByRole('button', { name: 'Saving...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockUpdateItad.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('ItadForm — configured state', () => {
    beforeEach(resetMocks);

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

    it('Test Connection button is loading and swallows the click when test is pending', () => {
        mockItadStatus.data = { configured: true };
        mockTestItad.isPending = true;
        render(<ItadForm />);
        const btn = screen.getByRole('button', { name: 'Testing...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockTestItad.mutateAsync).not.toHaveBeenCalled();
    });

    it('Clear button is loading and swallows the click when clear is pending', () => {
        mockItadStatus.data = { configured: true };
        mockClearItad.isPending = true;
        render(<ItadForm />);
        const btn = screen.getByRole('button', { name: 'Clear' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockClearItad.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('ItadForm — unconfigured state', () => {
    beforeEach(resetMocks);

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
