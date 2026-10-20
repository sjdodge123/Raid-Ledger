/**
 * V9 (ROK-1868) — the shared inline tokenizer: escapes, strike, nested marks,
 * unbalanced delimiters, autolinks, and the ROK-1077 href cases re-run against
 * it (link safety now comes from the contract's `isSafeMarkdownHref`).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownInline } from './markdown-inline';

function mount(text: string, strike?: boolean): HTMLElement {
    const props = strike === undefined ? { text } : { text, strike };
    const { container } = render(<p data-testid="host"><MarkdownInline {...props} /></p>);
    const host = container.querySelector('[data-testid="host"]');
    if (!(host instanceof HTMLElement)) throw new Error('host not rendered');
    return host;
}

describe('MarkdownInline — marks', () => {
    it('renders bold, italic, strike and code', () => {
        const host = mount('**b** *i* ~~s~~ `c`');
        expect(host.querySelector('strong')?.textContent).toBe('b');
        expect(host.querySelector('em')?.textContent).toBe('i');
        expect(host.querySelector('s')?.textContent).toBe('s');
        expect(host.querySelector('code')?.textContent).toBe('c');
    });

    it('nests a link inside bold', () => {
        const host = mount('**[docs](/x)**');
        const link = host.querySelector('strong > a');
        expect(link?.getAttribute('href')).toBe('/x');
        expect(link?.textContent).toBe('docs');
    });

    it('nests marks inside a link label', () => {
        const host = mount('[**big** news](https://example.com)');
        expect(host.querySelector('a > strong')?.textContent).toBe('big');
    });

    it('renders ***both*** as strong > em', () => {
        expect(mount('***both***').querySelector('strong > em')?.textContent).toBe('both');
    });

    it('nests italic inside bold', () => {
        expect(mount('**a *b* c**').querySelector('strong > em')?.textContent).toBe('b');
    });

    it('keeps marks out of code spans', () => {
        const host = mount('`**not bold**`');
        expect(host.querySelector('strong')).toBeNull();
        expect(host.querySelector('code')?.textContent).toBe('**not bold**');
    });

    it('strike:false leaves ~~x~~ literal', () => {
        const host = mount('~~x~~', false);
        expect(host.querySelector('s')).toBeNull();
        expect(host.textContent).toBe('~~x~~');
    });
});

describe('MarkdownInline — literals', () => {
    it('leaves an unbalanced **x literal', () => {
        const host = mount('**x');
        expect(host.querySelector('strong')).toBeNull();
        expect(host.textContent).toBe('**x');
    });

    it('a backslash escapes a delimiter', () => {
        const host = mount('\\*not italic\\* and \\[x\\](/y)');
        expect(host.querySelector('em')).toBeNull();
        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toBe('*not italic* and [x](/y)');
    });

    it('does not treat a spaced * as emphasis', () => {
        const host = mount('2 * 3 * 4');
        expect(host.querySelector('em')).toBeNull();
        expect(host.textContent).toBe('2 * 3 * 4');
    });

    it('renders HTML as text, never as elements', () => {
        const host = mount('<b>hi</b><img src=x onerror=alert(1)>');
        expect(host.querySelector('b')).toBeNull();
        expect(host.querySelector('img')).toBeNull();
        expect(host.textContent).toBe('<b>hi</b><img src=x onerror=alert(1)>');
    });

    it('image syntax stays literal — no img, no link', () => {
        const host = mount('![a](https://x/p.png)');
        expect(host.querySelector('img')).toBeNull();
        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toBe('![a](https://x/p.png)');
    });
});

describe('MarkdownInline — links (ROK-1077 cases on the shared tokenizer)', () => {
    it('renders a safe link with rel="noopener noreferrer"', () => {
        mount('[site](https://example.com/ok)');
        const link = screen.getByRole('link', { name: 'site' });
        expect(link).toHaveAttribute('href', 'https://example.com/ok');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders an http(s) autolink', () => {
        mount('see <https://example.com/a>');
        expect(screen.getByRole('link', { name: 'https://example.com/a' })).toHaveAttribute('href', 'https://example.com/a');
    });

    it.each([
        ['protocol-relative', '[x](//evil.com/phish)'],
        ['backslash protocol-relative', '[x](/\\evil.com)'],
        ['javascript:', '[x](javascript:alert(1))'],
        ['embedded tab', '[x](/\t/evil.com)'],
        ['embedded CR', '[x](/\r/evil.com)'],
        ['NUL', '[x](https://example.com/\u0000evil)'],
        ['space', '[x](/events/1 2)'],
        ['javascript: autolink', '<javascript:alert(1)>'],
    ])('rejects a %s href — no anchor, raw text kept', (_label, text) => {
        const host = mount(text);
        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toBe(text);
    });
});
