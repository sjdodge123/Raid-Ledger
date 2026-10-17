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

    it('rejects the backslash protocol-relative variant /\\host', () => {
        render(<MarkdownText text={'[x](/\\evil.com)'} />);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('still rejects other unsupported schemes (javascript:)', () => {
        render(<MarkdownText text="[x](javascript:alert(1))" />);
        expect(screen.queryByRole('link')).toBeNull();
    });

    // A browser strips tab/LF/CR from a URL BEFORE resolving its origin, so a
    // leading-character check alone is not enough: "/<tab>/evil.com" has a safe
    // first two characters here and arrives at the network as "//evil.com".
    it('rejects an embedded tab that would strip down to a protocol-relative URL', () => {
        render(<MarkdownText text={'[x](/\t/evil.com)'} />);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('rejects an embedded carriage return in an app-relative href', () => {
        render(<MarkdownText text={'[x](/\r/evil.com)'} />);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('rejects a NUL control character in an absolute href', () => {
        render(<MarkdownText text={'[x](https://example.com/\u0000evil)'} />);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('rejects a plain space in an href', () => {
        render(<MarkdownText text="[x](/events/1 2)" />);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
