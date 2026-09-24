/**
 * ROK-1652 (verify B): shared assertion for the admin integration action triad.
 * Save Configuration is a full-width primary row below `lg` (flex-1 only from
 * `lg`), then Test Connection (secondary) and Clear (soft danger), each on one line.
 */
import { expect } from 'vitest';
import { screen } from '@testing-library/react';

const TRIAD = ['Save Configuration', 'Test Connection', 'Clear'];

export function expectIntegrationActionTriad(): void {
    const buttons = screen.getAllByRole('button').filter((b) => TRIAD.includes(b.textContent ?? ''));
    expect(buttons.map((b) => b.textContent)).toEqual(TRIAD);
    const [save, test, clear] = buttons;
    expect(save).toHaveClass('bg-emerald-600', 'w-full', 'lg:w-auto', 'lg:flex-1');
    expect(save).not.toHaveClass('flex-1');
    expect(test).toHaveClass('bg-panel', 'whitespace-nowrap');
    expect(clear).toHaveClass('bg-danger/10', 'whitespace-nowrap');
}
