import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip, type StatusChipTone } from './status-chip';

describe('StatusChip (ROK-1776)', () => {
    const cases: [StatusChipTone, string][] = [
        ['success', 'text-success'],
        ['warning', 'text-warning'],
        ['danger', 'text-danger'],
        ['neutral', 'text-muted'],
    ];

    it.each(cases)('tone %s → data-tone + %s token class', (tone, cls) => {
        render(<StatusChip tone={tone} title={`t-${tone}`}>label</StatusChip>);
        const chip = screen.getByText('label');
        expect(chip.getAttribute('data-tone')).toBe(tone);
        expect(chip.className).toContain(cls);
        expect(chip.getAttribute('title')).toBe(`t-${tone}`);
    });

    it('keeps the §4.21 shape classes and appends className', () => {
        render(<StatusChip tone="neutral" title="x" className="ml-2">chip</StatusChip>);
        const chip = screen.getByText('chip');
        expect(chip.className).toContain('rounded-full border px-2 py-0.5 text-xs font-mono');
        expect(chip.className).toContain('bg-panel border-edge');
        expect(chip.className.endsWith(' ml-2')).toBe(true);
    });
});
