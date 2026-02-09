import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarSelectorModal } from './AvatarSelectorModal';

describe('AvatarSelectorModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        currentAvatarUrl: 'https://example.com/avatar1.png',
        avatarOptions: [
            { url: 'https://example.com/avatar1.png', label: 'Discord' },
            { url: 'https://example.com/avatar2.png', label: 'Thrall' },
            { url: 'https://example.com/avatar3.png', label: 'Jaina' },
        ],
        onSelect: vi.fn(),
    };

    it('renders when isOpen is true', () => {
        render(<AvatarSelectorModal {...defaultProps} />);
        expect(screen.getByText('Choose Avatar')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        render(<AvatarSelectorModal {...defaultProps} isOpen={false} />);
        expect(screen.queryByText('Choose Avatar')).not.toBeInTheDocument();
    });

    it('renders all avatar options', () => {
        render(<AvatarSelectorModal {...defaultProps} />);
        expect(screen.getByLabelText('Select avatar: Discord')).toBeInTheDocument();
        expect(screen.getByLabelText('Select avatar: Thrall')).toBeInTheDocument();
        expect(screen.getByLabelText('Select avatar: Jaina')).toBeInTheDocument();
    });

    it('highlights the currently selected avatar', () => {
        const { container } = render(<AvatarSelectorModal {...defaultProps} />);
        const selected = container.querySelector('.avatar-selector-option--selected');
        expect(selected).toBeInTheDocument();
    });

    it('calls onSelect when an avatar option is clicked', () => {
        const onSelect = vi.fn();
        render(<AvatarSelectorModal {...defaultProps} onSelect={onSelect} />);
        fireEvent.click(screen.getByLabelText('Select avatar: Thrall'));
        expect(onSelect).toHaveBeenCalledWith('https://example.com/avatar2.png');
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<AvatarSelectorModal {...defaultProps} onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when Done button is clicked', () => {
        const onClose = vi.fn();
        render(<AvatarSelectorModal {...defaultProps} onClose={onClose} />);
        fireEvent.click(screen.getByText('Done'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows empty state when no avatar options', () => {
        render(<AvatarSelectorModal {...defaultProps} avatarOptions={[]} />);
        expect(screen.getByText('No avatar options available.')).toBeInTheDocument();
    });
});
