/**
 * Unit tests for CopyableInput keyboard accessibility (ROK-881).
 * Verifies that Enter key on the input triggers copy-to-clipboard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopyableInput } from './admin-form-helpers';

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
});
