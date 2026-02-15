import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobilePageToolbar } from './mobile-page-toolbar';

describe('MobilePageToolbar', () => {
    it('renders children', () => {
        render(<MobilePageToolbar>Test Content</MobilePageToolbar>);
        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('applies correct z-index from Z_INDEX.TOOLBAR constant', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar).toHaveStyle({ zIndex: 30 });
    });

    it('has md:hidden class for mobile-only visibility', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar).toHaveClass('md:hidden');
    });

    it('has sticky positioning at top-16', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar).toHaveClass('sticky', 'top-16');
    });

    it('has frosted glass effect classes', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar).toHaveClass('bg-surface/95', 'backdrop-blur-sm');
    });

    it('has border bottom for visual separation', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar).toHaveClass('border-b');
    });

    it('applies className to inner container div', () => {
        render(<MobilePageToolbar className="space-y-3">Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar');
        // className should NOT be on the outer toolbar div
        expect(toolbar).not.toHaveClass('space-y-3');
        // It should be on the inner div (child of toolbar)
        const innerDiv = toolbar.firstElementChild;
        expect(innerDiv).toHaveClass('space-y-3');
    });

    it('applies custom aria-label', () => {
        render(<MobilePageToolbar aria-label="Custom label">Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar', { name: 'Custom label' });
        expect(toolbar).toBeInTheDocument();
    });

    it('has default aria-label', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        const toolbar = screen.getByRole('toolbar', { name: 'Page toolbar' });
        expect(toolbar).toBeInTheDocument();
    });

    it('has role="toolbar"', () => {
        render(<MobilePageToolbar>Test</MobilePageToolbar>);
        expect(screen.getByRole('toolbar')).toBeInTheDocument();
    });
});
