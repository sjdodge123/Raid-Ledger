import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownText } from './markdown-text';

describe('MarkdownText link validation (ROK-1077 item 1)', () => {
    it('rejects protocol-relative //host hrefs — renders raw text, no anchor', () => {
        render(<MarkdownText text="[click me](//evil.com/phish)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('[click me](//evil.com/phish)')).toBeInTheDocument();
    });

    it('still renders app-relative /path hrefs as links', () => {
        render(<MarkdownText text="[events](/events/42)" />);
        const link = screen.getByRole('link', { name: 'events' });
        expect(link).toHaveAttribute('href', '/events/42');
    });

    it('still renders absolute http(s) hrefs as links', () => {
        render(<MarkdownText text="[site](https://example.com/ok)" />);
        const link = screen.getByRole('link', { name: 'site' });
        expect(link).toHaveAttribute('href', 'https://example.com/ok');
    });

    it('still rejects other unsupported schemes (javascript:)', () => {
        render(<MarkdownText text="[x](javascript:alert(1))" />);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
