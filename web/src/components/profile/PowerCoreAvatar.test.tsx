import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PowerCoreAvatar } from './PowerCoreAvatar';

describe('PowerCoreAvatar', () => {
    const defaultProps = {
        avatarUrl: 'https://example.com/avatar.png',
        username: 'TestUser',
        onEdit: vi.fn(),
        onCyclePrev: vi.fn(),
        onCycleNext: vi.fn(),
        hasMultipleAvatars: true,
    };

    it('renders avatar image', () => {
        render(<PowerCoreAvatar {...defaultProps} />);
        const img = screen.getByAltText('TestUser');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
    });

    it('renders username', () => {
        render(<PowerCoreAvatar {...defaultProps} />);
        expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('shows admin badge when role is admin', () => {
        render(<PowerCoreAvatar {...defaultProps} role="admin" />);
        expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('shows operator badge when role is operator', () => {
        render(<PowerCoreAvatar {...defaultProps} role="operator" />);
        expect(screen.getByText('Operator')).toBeInTheDocument();
    });

    it('does not show role badge when role is member', () => {
        render(<PowerCoreAvatar {...defaultProps} role="member" />);
        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        expect(screen.queryByText('Operator')).not.toBeInTheDocument();
    });

    it('calls onEdit when edit button is clicked', () => {
        const onEdit = vi.fn();
        render(<PowerCoreAvatar {...defaultProps} onEdit={onEdit} />);
        fireEvent.click(screen.getByLabelText('Change avatar'));
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('shows navigation arrows when hasMultipleAvatars is true', () => {
        render(<PowerCoreAvatar {...defaultProps} hasMultipleAvatars={true} />);
        expect(screen.getByLabelText('Previous avatar')).toBeInTheDocument();
        expect(screen.getByLabelText('Next avatar')).toBeInTheDocument();
    });

    it('hides navigation arrows when hasMultipleAvatars is false', () => {
        render(<PowerCoreAvatar {...defaultProps} hasMultipleAvatars={false} />);
        expect(screen.queryByLabelText('Previous avatar')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Next avatar')).not.toBeInTheDocument();
    });

    it('calls onCyclePrev and onCycleNext on arrow clicks', () => {
        const onCyclePrev = vi.fn();
        const onCycleNext = vi.fn();
        render(
            <PowerCoreAvatar
                {...defaultProps}
                onCyclePrev={onCyclePrev}
                onCycleNext={onCycleNext}
            />
        );
        fireEvent.click(screen.getByLabelText('Previous avatar'));
        expect(onCyclePrev).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByLabelText('Next avatar'));
        expect(onCycleNext).toHaveBeenCalledOnce();
    });

    it('has glow ring element', () => {
        const { container } = render(<PowerCoreAvatar {...defaultProps} />);
        expect(container.querySelector('.power-core__ring')).toBeInTheDocument();
    });
});
