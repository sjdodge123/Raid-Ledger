import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LiveRegionProvider } from './live-region-provider';

describe('LiveRegionProvider', () => {
    it('renders two live region divs', () => {
        const { container } = render(<LiveRegionProvider />);
        const divs = container.querySelectorAll('div');
        expect(divs).toHaveLength(2);
    });

    it('renders a polite live region with id="aria-live-polite"', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        expect(politeRegion).toBeInTheDocument();
    });

    it('renders an assertive live region with id="aria-live-assertive"', () => {
        render(<LiveRegionProvider />);
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(assertiveRegion).toBeInTheDocument();
    });

    it('polite region has role="status"', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        expect(politeRegion).toHaveAttribute('role', 'status');
    });

    it('assertive region has role="alert"', () => {
        render(<LiveRegionProvider />);
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(assertiveRegion).toHaveAttribute('role', 'alert');
    });

    it('polite region has aria-live="polite"', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        expect(politeRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('assertive region has aria-live="assertive"', () => {
        render(<LiveRegionProvider />);
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(assertiveRegion).toHaveAttribute('aria-live', 'assertive');
    });

    it('both regions have aria-atomic="true"', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(politeRegion).toHaveAttribute('aria-atomic', 'true');
        expect(assertiveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    it('both regions have sr-only class (visually hidden)', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(politeRegion).toHaveClass('sr-only');
        expect(assertiveRegion).toHaveClass('sr-only');
    });

    it('regions are empty on initial render', () => {
        render(<LiveRegionProvider />);
        const politeRegion = document.getElementById('aria-live-polite');
        const assertiveRegion = document.getElementById('aria-live-assertive');
        expect(politeRegion?.textContent).toBe('');
        expect(assertiveRegion?.textContent).toBe('');
    });
});
