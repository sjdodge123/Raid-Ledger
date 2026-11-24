import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NotificationMatrixDemo } from './notification-matrix-demo';

describe('NotificationMatrixDemo (ROK-2311)', () => {
    it('renders the real group heading and the not-offered cells', () => {
        render(<NotificationMatrixDemo />);
        const demo = screen.getByTestId('ds-notification-matrix');
        expect(within(demo).getByRole('region', { name: 'Lineups & polls' })).toBeInTheDocument();
        const lfg = demo.querySelector<HTMLElement>('#notif-lineup_lfg_offer');
        if (!lfg) throw new Error('in-app-only row not rendered');
        expect(within(lfg).getByTestId('notif-not-offered-push')).toHaveTextContent('Not sent by Push');
        const dm = demo.querySelector<HTMLElement>('#notif-valheim_claim_suggestion');
        if (!dm) throw new Error('DM-only row not rendered');
        expect(within(dm).getAllByRole('button')).toHaveLength(1);
        expect(within(dm).getByTestId('notif-not-offered-inApp')).toBeInTheDocument();
    });
});
