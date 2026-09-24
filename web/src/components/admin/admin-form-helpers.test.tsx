/**
 * Unit tests for the admin integration form helpers.
 * - CopyableInput keyboard accessibility (ROK-881): Enter copies, other keys don't.
 * - ROK-1652 E1: the helpers sit on the shared ui primitives — a real copy
 *   Button, the ui PasswordInput toggle, and success/danger banner tokens.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopyableInput, FormTextField, PasswordInput, TestResultBanner } from './admin-form-helpers';

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

describe('CopyableInput — keyboard accessibility (ROK-881)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // ROK-1378: copyToClipboard only uses the async Clipboard API in a
        // secure context; jsdom defaults isSecureContext to undefined.
        Object.defineProperty(window, 'isSecureContext', {
            configurable: true,
            value: true,
        });
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('copies value to clipboard on Enter key', async () => {
        render(<CopyableInput value="test-value" onCopied="Copied!" />);
        const input = screen.getByDisplayValue('test-value');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'test-value',
        );
    });

    it('does not copy on other keys', () => {
        render(<CopyableInput value="test-value" onCopied="Copied!" />);
        const input = screen.getByDisplayValue('test-value');
        fireEvent.keyDown(input, { key: 'Tab' });
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('copies the value when the "Copy <label>" button is clicked (ROK-1652)', () => {
        render(<CopyableInput value="http://localhost" onCopied="Copied!" label="Redirect URI" />);
        fireEvent.click(screen.getByRole('button', { name: 'Copy Redirect URI' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost');
        expect(screen.getByDisplayValue('http://localhost')).toHaveAttribute('readonly');
    });
});

function ControlledPassword({ fieldLabel }: { fieldLabel?: string }) {
    const [shown, setShown] = useState(false);
    const [value, setValue] = useState('s3cret');
    return (
        <>
            <label htmlFor="pw">Secret</label>
            <PasswordInput id="pw" value={value} onChange={setValue} placeholder="Secret"
                showPassword={shown} onToggleShow={() => setShown(!shown)} fieldLabel={fieldLabel} />
        </>
    );
}

describe('PasswordInput — ui PasswordInput underneath (ROK-1652)', () => {
    it('toggle is named "Show <fieldLabel>" and flips the input type', () => {
        render(<ControlledPassword fieldLabel="API key" />);
        const input = screen.getByLabelText('Secret');
        expect(input).toHaveAttribute('type', 'password');
        const toggle = screen.getByRole('button', { name: 'Show API key' });
        expect(toggle).toHaveAttribute('aria-controls', 'pw');
        fireEvent.click(toggle);
        expect(input).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: 'Hide API key' })).toBeInTheDocument();
    });

    it('defaults the toggle name to "Show password" and reports edits', () => {
        render(<ControlledPassword />);
        expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 'new' } });
        expect(screen.getByLabelText('Secret')).toHaveValue('new');
    });
});

describe('FormTextField — Field + Input (ROK-1652)', () => {
    it('labels the input by its label and keeps the caller id', () => {
        const onChange = vi.fn();
        render(<FormTextField id="cid" label="Client ID" value="" onChange={onChange} placeholder="id" />);
        const input = screen.getByRole('textbox', { name: 'Client ID' });
        expect(input).toHaveAttribute('id', 'cid');
        fireEvent.change(input, { target: { value: 'abc' } });
        expect(onChange).toHaveBeenCalledWith('abc');
    });
});

describe('TestResultBanner — success/danger tokens (ROK-1652)', () => {
    it('renders a success message on the success token', () => {
        render(<TestResultBanner result={{ success: true, message: 'Connected!' }} />);
        const banner = screen.getByText('Connected!');
        expect(banner).toHaveClass('bg-success/10', 'border-success/30', 'text-success');
    });

    it('renders a failure message on the danger token', () => {
        render(<TestResultBanner result={{ success: false, message: 'Bad credentials' }} />);
        const banner = screen.getByText('Bad credentials');
        expect(banner).toHaveClass('bg-danger/10', 'border-danger/30', 'text-danger');
    });

    it('renders nothing without a result', () => {
        const { container } = render(<TestResultBanner result={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});
