import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntegrationSpoke } from './IntegrationSpoke';

describe('IntegrationSpoke', () => {
    it('renders active spoke with correct label and status', () => {
        render(
            <IntegrationSpoke
                platform="discord"
                status="active"
                label="Discord"
                statusText="Connected"
                angle={0}
            />
        );
        expect(screen.getByText('Discord')).toBeInTheDocument();
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('renders dormant spoke with plus overlay', () => {
        const { container } = render(
            <IntegrationSpoke
                platform="discord"
                status="dormant"
                label="Discord"
                statusText="Not Linked"
                angle={0}
            />
        );
        expect(container.querySelector('.spoke-node__plus')).toBeInTheDocument();
        expect(container.querySelector('.spoke-node--dormant')).toBeInTheDocument();
    });

    it('renders placeholder spoke with lock overlay', () => {
        const { container } = render(
            <IntegrationSpoke
                platform="battlenet"
                status="placeholder"
                label="Battle.net"
                statusText="Coming Soon"
                angle={0}
            />
        );
        expect(container.querySelector('.spoke-node__lock')).toBeInTheDocument();
        expect(container.querySelector('.spoke-node--placeholder')).toBeInTheDocument();
    });

    it('calls onLink when dormant spoke is clicked', () => {
        const onLink = vi.fn();
        render(
            <IntegrationSpoke
                platform="discord"
                status="dormant"
                label="Discord"
                statusText="Not Linked"
                angle={0}
                onLink={onLink}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onLink).toHaveBeenCalledOnce();
    });

    it('calls onViewDetails when active spoke is clicked', () => {
        const onViewDetails = vi.fn();
        render(
            <IntegrationSpoke
                platform="discord"
                status="active"
                label="Discord"
                statusText="Connected"
                angle={0}
                onViewDetails={onViewDetails}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onViewDetails).toHaveBeenCalledOnce();
    });

    it('does not call any handler when placeholder is clicked', () => {
        const onLink = vi.fn();
        const onViewDetails = vi.fn();
        render(
            <IntegrationSpoke
                platform="steam"
                status="placeholder"
                label="Steam"
                statusText="Coming Soon"
                angle={0}
                onLink={onLink}
                onViewDetails={onViewDetails}
            />
        );
        // Placeholder has tabIndex -1 but has role="button"
        const button = screen.getByRole('button', { name: /Steam/i });
        fireEvent.click(button);
        expect(onLink).not.toHaveBeenCalled();
        expect(onViewDetails).not.toHaveBeenCalled();
    });

    it('shows tooltip text on hover', () => {
        render(
            <IntegrationSpoke
                platform="discord"
                status="active"
                label="Discord"
                statusText="Connected"
                angle={0}
                tooltipText="Discord account linked — click for details"
            />
        );
        expect(screen.getByText('Discord account linked — click for details')).toBeInTheDocument();
    });

    it('sets correct aria-label', () => {
        render(
            <IntegrationSpoke
                platform="discord"
                status="active"
                label="Discord"
                statusText="Connected"
                angle={0}
            />
        );
        expect(screen.getByLabelText('Discord — Connected')).toBeInTheDocument();
    });
});
