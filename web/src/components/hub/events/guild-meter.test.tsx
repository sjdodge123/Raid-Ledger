/** ROK-1787 / ROK-1905 — the shared quantity bar and its fill tones. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuildMeter } from './guild-meter';

function fill(): Element | null {
    return screen.getByRole('meter').firstElementChild;
}

describe('GuildMeter', () => {
    it('clamps and rounds the value it reports', () => {
        render(<GuildMeter pct={140.4} label="Over" />);
        expect(screen.getByRole('meter', { name: 'Over' })).toHaveAttribute('aria-valuenow', '100');
    });

    it('fills with the success tone by default', () => {
        render(<GuildMeter pct={40} label="Default" />);
        expect(fill()).toHaveClass('bg-success');
    });

    it('fills with the secondary token, not success green, in the neutral tone', () => {
        render(<GuildMeter pct={40} tone="neutral" label="Neutral" />);
        expect(fill()).toHaveClass('bg-secondary');
        expect(fill()).not.toHaveClass('bg-success');
        expect(fill()).toHaveStyle({ width: '40%' });
    });
});
