/**
 * ROK-1789 Part B (B-4) — one instance section of the Progression tab:
 * `down/total` or `down/?`, the "On farm" chip only when cleared, the meter's
 * tone + label, the latest-kill line, and the difficulty label only when the
 * instance spans more than one difficulty (B3).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildProgressionBoss, buildProgressionInstance } from '../../../test/mocks/guild-progression-handlers';
import { ProgressionInstance } from './progression-instance';

describe('ProgressionInstance', () => {
    it('shows down/total, a warning meter and the latest kill, with no On farm chip when not cleared', () => {
        render(<ProgressionInstance instance={buildProgressionInstance()} />);
        const section = screen.getByTestId('progression-instance');
        expect(within(section).getByRole('heading', { name: 'Molten Core' })).toBeInTheDocument();
        expect(within(section).getByTestId('progression-instance-count')).toHaveTextContent('2/10');
        const meter = within(section).getByRole('meter', { name: 'Molten Core: 2 of 10 bosses down' });
        expect(meter).toHaveAttribute('aria-valuenow', '20');
        expect(meter.firstElementChild).toHaveClass('bg-warning');
        expect(within(section).queryByText('On farm')).not.toBeInTheDocument();
        expect(within(section).getByTestId('progression-latest-kill')).toHaveTextContent(/^Latest kill: Magmadar · Nov 6$/);
    });

    it('shows the On farm chip and a success meter once every boss is down', () => {
        render(<ProgressionInstance instance={buildProgressionInstance({ bossesDown: 10 })} />);
        expect(screen.getByTestId('progression-instance-count')).toHaveTextContent('10/10');
        expect(screen.getByTitle('Every boss in this raid has been killed')).toHaveTextContent('On farm');
        expect(screen.getByRole('meter').firstElementChild).toHaveClass('bg-success');
    });

    it('shows down/? with no meter and no On farm chip when the boss total is unknown', () => {
        const other = buildProgressionInstance({ key: 'other', name: 'Other bosses', bossTotal: null, bossesDown: 3, latestKill: null });
        render(<ProgressionInstance instance={other} />);
        expect(screen.getByTestId('progression-instance-count')).toHaveTextContent('3/?');
        expect(screen.queryByRole('meter')).not.toBeInTheDocument();
        expect(screen.queryByText('On farm')).not.toBeInTheDocument();
        expect(screen.queryByTestId('progression-latest-kill')).not.toBeInTheDocument();
    });

    it('lists every boss with first kill, kills, wipes and last pull, hiding the difficulty label by default', () => {
        render(<ProgressionInstance instance={buildProgressionInstance()} />);
        const rows = screen.getAllByTestId('progression-boss-row');
        expect(rows).toHaveLength(2);
        const first = rows[0];
        if (first === undefined) throw new Error('no boss row');
        expect(within(first).getByText('Lucifron')).toBeInTheDocument();
        expect(within(first).getByText('First kill Nov 6')).toBeInTheDocument();
        expect(within(first).getByTestId('progression-boss-kills')).toHaveTextContent('1 kill');
        expect(within(first).getByTestId('progression-boss-wipes')).toHaveTextContent('2 wipes');
        expect(within(first).getByTestId('progression-boss-last-pull')).toHaveTextContent('Last pull Nov 10');
        expect(screen.queryByTestId('progression-boss-difficulty')).not.toBeInTheDocument();
    });

    it('shows the difficulty label on every row when showDifficulty is set', () => {
        const instance = buildProgressionInstance({
            showDifficulty: true,
            bosses: [buildProgressionBoss('Onyxia', { difficultyLabel: '40-player' }), buildProgressionBoss('Onyxia', { difficultyId: 3, difficultyLabel: '10-player', firstKillAt: null, kills: 0 })],
        });
        render(<ProgressionInstance instance={instance} />);
        expect(screen.getAllByTestId('progression-boss-difficulty').map((el) => el.textContent)).toEqual(['40-player', '10-player']);
        expect(screen.getByText('Not killed yet')).toBeInTheDocument();
    });
});
