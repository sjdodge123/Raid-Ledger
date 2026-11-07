/**
 * ROK-1928 D2 — the roster footer names Blizzard after a Blizzard roster sync.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessFooter } from './freshness-footer';

const NOW = new Date().toISOString();

describe('FreshnessFooter rosterVia', () => {
    it('reads "via Blizzard" for a roster fact when rosterVia is Blizzard', () => {
        render(<FreshnessFooter freshness={{ source: 'roster', asOf: NOW }} rosterVia="Blizzard" />);
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via Blizzard · as of/);
    });

    it('keeps "via LedgerLink" for a roster fact without rosterVia', () => {
        render(<FreshnessFooter freshness={{ source: 'roster', asOf: NOW }} />);
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via LedgerLink/);
    });

    it('ignores rosterVia for a non-roster source', () => {
        render(<FreshnessFooter freshness={{ source: 'manual', asOf: NOW }} rosterVia="Blizzard" />);
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via manual entry/);
    });
});
