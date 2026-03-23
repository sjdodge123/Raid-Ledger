/**
 * Tests for LineupStatusBadge (ROK-935).
 * Validates status-based rendering and text content.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineupStatusBadge } from './LineupStatusBadge';

describe('LineupStatusBadge', () => {
    it('renders "Nominating" text for building status', () => {
        render(<LineupStatusBadge status="building" />);
        expect(screen.getByText('Nominating')).toBeInTheDocument();
    });

    it('renders "Voting" text for voting status', () => {
        render(<LineupStatusBadge status="voting" />);
        expect(screen.getByText('Voting')).toBeInTheDocument();
    });

    it('renders "Decided" text for decided status', () => {
        render(<LineupStatusBadge status="decided" />);
        expect(screen.getByText('Decided')).toBeInTheDocument();
    });

    it('renders "Archived" text for archived status', () => {
        render(<LineupStatusBadge status="archived" />);
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('uses friendly label for building status', () => {
        render(<LineupStatusBadge status="building" />);
        const badge = screen.getByText('Nominating');
        expect(badge).toBeInTheDocument();
    });
});
