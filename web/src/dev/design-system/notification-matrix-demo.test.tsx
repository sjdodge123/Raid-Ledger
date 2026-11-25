import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NOTIFICATION_TYPE_META } from '../../components/profile/notification-type-meta';
import { NotificationMatrixDemo } from './notification-matrix-demo';

describe('NotificationMatrixDemo (ROK-2311)', () => {
    it('renders the real group heading and the not-offered cells', () => {
        render(<NotificationMatrixDemo />);
        const demo = screen.getByTestId('ds-notification-matrix');
        expect(within(demo).getByRole('region', { name: 'Lineups & polls' })).toBeInTheDocument();
        const lfg = demo.querySelector<HTMLElement>('#notif-lineup_lfg_offer');
        if (!lfg) throw new Error('in-app-only row not rendered');
        expect(within(lfg).getByTestId('notif-not-offered-discord')).toHaveTextContent('Not sent by Discord');
        expect(within(demo).queryByTestId('notif-not-offered-push')).toBeNull();
        const dm = demo.querySelector<HTMLElement>('#notif-valheim_claim_suggestion');
        if (!dm) throw new Error('DM-only row not rendered');
        expect(within(dm).getAllByRole('button')).toHaveLength(1);
        expect(within(dm).getByTestId('notif-not-offered-inApp')).toBeInTheDocument();
    });

    it('shows the shipped row copy, not a hand-typed copy', () => {
        render(<NotificationMatrixDemo />);
        const demo = screen.getByTestId('ds-notification-matrix');
        for (const type of ['scheduling_poll', 'lineup_lfg_offer', 'valheim_claim_suggestion']) {
            const meta = NOTIFICATION_TYPE_META.find((m) => m.type === type);
            if (!meta) throw new Error(`no meta for ${type}`);
            const row = demo.querySelector<HTMLElement>(`#notif-${type}`);
            if (!row) throw new Error(`${type} row not rendered`);
            expect(row).toHaveTextContent(meta.label);
            expect(row).toHaveTextContent(meta.description);
        }
    });

    it('an "on" switch names its column and uses the success token', () => {
        render(<NotificationMatrixDemo />);
        const row = screen.getByTestId('ds-notification-matrix').querySelector<HTMLElement>('#notif-scheduling_poll');
        if (!row) throw new Error('scheduling_poll row not rendered');
        const names = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
        expect(names).toEqual([
            'Disable Scheduling polls In-App notifications',
            'Enable Scheduling polls Discord notifications',
        ]);
        const on = within(row).getByRole('button', { name: 'Disable Scheduling polls In-App notifications' });
        expect(on.className).toContain('text-success');
        expect(on.className).toContain('bg-success/15');
        expect(on.className).not.toMatch(/emerald/);
    });
});
