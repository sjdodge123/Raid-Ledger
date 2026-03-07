import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { UserLink } from './UserLink';

const renderWithRouter = (component: React.ReactNode) => {
        return render(<BrowserRouter>{component}</BrowserRouter>);
    };
function userlinkGroup1() {
it('renders username as link to profile', () => {
        renderWithRouter(
            <UserLink userId={123} username="TestUser" />
        );

        const link = screen.getByRole('link', { name: /TestUser/i });
        expect(link).toHaveAttribute('href', '/users/123');
    });

it('shows avatar when showAvatar is true', () => {
        const { container } = renderWithRouter(
            <UserLink
                userId={1}
                username="AvatarUser"
                avatarUrl="https://example.com/avatar.png"
                showAvatar
            />
        );

        const avatar = container.querySelector('.user-link__avatar');
        expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.png');
    });

}

function userlinkGroup2() {
it('does not show avatar by default', () => {
        renderWithRouter(
            <UserLink
                userId={1}
                username="NoAvatar"
                avatarUrl="https://example.com/avatar.png"
            />
        );

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

}

function userlinkGroup3() {
it('stops propagation on click', () => {
        const parentClick = vi.fn();

        render(
            <BrowserRouter>
                <div onClick={parentClick}>
                    <UserLink userId={1} username="ClickTest" />
                </div>
            </BrowserRouter>
        );

        const link = screen.getByRole('link');
        link.click();

        // Parent handler should not have been called due to stopPropagation
        expect(parentClick).not.toHaveBeenCalled();
    });

it('applies custom className', () => {
        renderWithRouter(
            <UserLink userId={1} username="Styled" className="custom-class" />
        );

        const link = screen.getByRole('link');
        expect(link).toHaveClass('custom-class');
    });

}

function userlinkGroup4() {
it('applies size class correctly', () => {
        const { rerender } = renderWithRouter(
            <UserLink userId={1} username="SmallUser" size="sm" />
        );

        expect(screen.getByRole('link')).toHaveClass('user-link--sm');

        rerender(
            <BrowserRouter>
                <UserLink userId={1} username="MediumUser" size="md" />
            </BrowserRouter>
        );

        expect(screen.getByRole('link')).toHaveClass('user-link--md');
    });

}

describe('UserLink', () => {
    userlinkGroup1();
    userlinkGroup2();
    userlinkGroup3();
    userlinkGroup4();
});
