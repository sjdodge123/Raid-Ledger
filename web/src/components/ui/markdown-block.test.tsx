/**
 * V8 (ROK-1868) — `MarkdownBlock`: every allowed element of the D14 subset
 * renders its tag, `#`–`###` headings included (ROK-1898, as h3–h5);
 * everything else (HTML, `####`+, quotes, images, unsafe links) renders as
 * literal text. React elements only — no innerHTML.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownBlock } from './markdown-block';
import { MD_CLASSES } from './markdown/markdown-classes';

function mount(text: string): HTMLElement {
    const { container } = render(<MarkdownBlock text={text} testId="md" />);
    const root = container.querySelector('[data-testid="md"]');
    if (!(root instanceof HTMLElement)) throw new Error('MarkdownBlock root not rendered');
    return root;
}

describe('MarkdownBlock — allowed elements', () => {
    it('renders every inline mark with its tag', () => {
        const root = mount('**b** *i* ~~s~~ `c` [l](/x)');
        expect(root.querySelector('strong')?.textContent).toBe('b');
        expect(root.querySelector('em')?.textContent).toBe('i');
        expect(root.querySelector('s')?.textContent).toBe('s');
        expect(root.querySelector('code')?.textContent).toBe('c');
        const a = root.querySelector('a');
        expect(a?.getAttribute('href')).toBe('/x');
        expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('a blank line splits paragraphs; a single newline is a <br>', () => {
        const root = mount('one\ntwo\n\nthree');
        const ps = root.querySelectorAll('p');
        expect(ps).toHaveLength(2);
        expect(ps[0]?.querySelectorAll('br')).toHaveLength(1);
        expect(ps[1]?.textContent).toBe('three');
        expect(ps[0]).toHaveClass(MD_CLASSES.p);
    });

    it('renders a bullet list from -, * and + lines', () => {
        const root = mount('- a\n* b\n+ c');
        const items = root.querySelectorAll('ul > li');
        expect(items).toHaveLength(3);
        expect(items[2]?.textContent).toBe('c');
        expect(root.querySelector('ul')).toHaveClass('list-disc');
    });

    it('renders a numbered list keeping its start number', () => {
        const root = mount('3. x\n4. y');
        const ol = root.querySelector('ol');
        expect(ol?.getAttribute('start')).toBe('3');
        expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    });

    it('flattens indented list lines to one level', () => {
        const root = mount('- a\n  - b');
        expect(root.querySelectorAll('ul')).toHaveLength(1);
        expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    });

    it('nests a link inside bold', () => {
        expect(mount('**[a](/x)**').querySelector('strong > a')?.getAttribute('href')).toBe('/x');
    });

    it('splits a paragraph and a following list', () => {
        const root = mount('intro\n- a\n- b\n\nafter');
        expect(root.querySelectorAll('p')).toHaveLength(2);
        expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    });
});

describe('MarkdownBlock — hard-break continuations in list items (Codex r2)', () => {
    it('keeps an unindented line after a hard break inside its numbered item (Codex r2)', () => {
        const root = mount('1. one  \ncontinued\n2. two');
        expect(root.querySelectorAll('ol'), 'a hard-break continuation must not split the list').toHaveLength(1);
        expect(root.querySelectorAll('p'), 'the continuation must not become a paragraph').toHaveLength(0);
        const items = root.querySelectorAll('ol > li');
        expect(items).toHaveLength(2);
        expect(items[0]?.textContent).toBe('onecontinued');
        expect(items[0]?.querySelectorAll('br')).toHaveLength(1);
    });

    it('keeps an unindented line after a backslash hard break inside its bullet item (Codex r2)', () => {
        const root = mount('- one\\\ncontinued\n- two');
        expect(root.querySelectorAll('ul'), 'a hard-break continuation must not split the list').toHaveLength(1);
        expect(root.querySelectorAll('p'), 'the continuation must not become a paragraph').toHaveLength(0);
        const items = root.querySelectorAll('ul > li');
        expect(items).toHaveLength(2);
        expect(items[0]?.textContent).toBe('onecontinued');
    });

    it('a blank line after a hard-break item still ends the list', () => {
        const root = mount('- one  \n\nafter');
        expect(root.querySelectorAll('ul > li')).toHaveLength(1);
        expect(root.querySelector('p')?.textContent).toBe('after');
    });

    it('an unindented line after an item WITHOUT a hard break still starts a paragraph', () => {
        const root = mount('- one\nafter');
        expect(root.querySelectorAll('ul > li')).toHaveLength(1);
        expect(root.querySelector('p')?.textContent).toBe('after');
    });
});

describe('MarkdownBlock — link titles (Codex r3)', () => {
    it.each([
        ['double quotes', '[Plan](https://example.com "Strategy")'],
        ['single quotes', "[Plan](https://example.com 'Strategy')"],
        ['parentheses', '[Plan](https://example.com (Strategy))'],
    ])('a link with a %s title is still a link, title dropped', (_kind, md) => {
        const link = mount(md).querySelector('a');
        expect(link, `${md} must render as a link, not literal text`).not.toBeNull();
        expect(link?.getAttribute('href')).toBe('https://example.com');
        expect(link?.textContent).toBe('Plan');
    });

    it('the title never rescues an unsafe destination', () => {
        expect(mount('[x](javascript:alert(1) "t")').querySelector('a')).toBeNull();
    });
});

describe('MarkdownBlock — angle-bracket link destinations (Codex r12)', () => {
    it.each([
        ['[home](</events>)', '/events', 'home'],
        ['[Plan](<https://example.com> "Strategy")', 'https://example.com', 'Plan'],
    ])('%j renders as a link to %s', (md, href, label) => {
        const root = mount(md);
        const link = root.querySelector('a');
        expect(link, `${md} must render as a link, not literal text`).not.toBeNull();
        expect(link?.getAttribute('href')).toBe(href);
        expect(root.textContent, 'no destination syntax leaks into the text').toBe(label);
    });

    it('an unsafe <javascript:…> destination is still literal text', () => {
        const root = mount('[x](<javascript:alert(1)>)');
        expect(root.querySelector('a')).toBeNull();
        expect(root.textContent).toBe('[x](<javascript:alert(1)>)');
    });
});

describe('MarkdownBlock — headings (ROK-1898)', () => {
    it.each([
        ['# A', 'h3', MD_CLASSES.h1],
        ['## A', 'h4', MD_CLASSES.h2],
        ['### A', 'h5', MD_CLASSES.h3],
    ])('%j renders a card-level <%s> with its MD_CLASSES', (text, tag, cls) => {
        const root = mount(text);
        const heading = root.querySelector(tag);
        expect(heading?.textContent).toBe('A');
        expect(heading?.className).toBe(cls);
        expect(root.querySelector('h1, h2'), 'a post never renders a page-level heading').toBeNull();
    });

    it('a heading carries inline marks and interrupts the paragraph around it', () => {
        const root = mount('intro\n## **Raid** [plan](/p)\nbody');
        expect([...root.children].map((c) => c.tagName)).toEqual(['P', 'H4', 'P']);
        expect(root.querySelector('h4 strong')?.textContent).toBe('Raid');
        expect(root.querySelector('h4 a')?.getAttribute('href')).toBe('/p');
    });

    it('two or more spaces after the marker still make a heading (one or more spaces)', () => {
        const root = mount('#  Raid\n\n##   Loot');
        expect(root.querySelector('h3')?.textContent).toBe('Raid');
        expect(root.querySelector('h4')?.textContent).toBe('Loot');
    });

    it('an indented or tab-separated marker is not a heading (column 0, then a space)', () => {
        const root = mount(' # a\n\n#\tb');
        expect(root.querySelector('h3')).toBeNull();
        expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['# a', '#\tb']);
    });

    it('a heading marker inside a list item stays literal item text', () => {
        const root = mount('- # x\n1. ## y');
        expect(root.querySelector('h3, h4')).toBeNull();
        expect([...root.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['# x', '## y']);
    });
});

describe('MarkdownBlock — a backfilled legacy post (migration 0246) stays literal', () => {
    // 0246_hub_posts_backfill copies guild_profiles.gm_post verbatim: raw HTML, CRLF line ends and
    // runs of blank lines are all possible in that plain text.
    const LEGACY = 'Raid <b>night</b> is Thursday\r\n\r\n\r\nBring flasks\r\nand food\r\n# Loot rules';

    it('shows raw HTML as text and keeps every line break', () => {
        const root = mount(LEGACY);
        expect(root.querySelector('b')).toBeNull();
        const paragraphs = [...root.querySelectorAll('p')];
        expect(paragraphs.map((p) => p.textContent)).toEqual(['Raid <b>night</b> is Thursday', 'Bring flasksand food']);
        expect(paragraphs[1]?.querySelectorAll('br')).toHaveLength(1);
        expect(root.querySelector('h3')?.textContent).toBe('Loot rules');
    });
});

describe('MarkdownBlock — disallowed input is literal', () => {
    it('renders <script> as text, never an element', () => {
        const root = mount('<script>alert(1)</script>');
        expect(root.querySelector('script')).toBeNull();
        expect(root.textContent).toBe('<script>alert(1)</script>');
    });

    it.each([
        ['an img tag', '<img src=x onerror=alert(1)>', 'img'],
        ['a javascript: link', '[x](javascript:alert(1))', 'a'],
        ['a four-hash heading', '#### h', 'h6'],
        ['a heading with no space', '#h', 'h3'],
        ['an image', '![a](https://x/p.png)', 'img'],
        ['a block quote', '> q', 'blockquote'],
    ])('renders %s as literal text', (_label, text, tag) => {
        const root = mount(text);
        expect(root.querySelector(tag)).toBeNull();
        expect(root.textContent).toBe(text);
    });

    it('passes className through to the root', () => {
        const { container } = render(<MarkdownBlock text="x" className="max-h-24" testId="md" />);
        expect(container.querySelector('[data-testid="md"]')).toHaveClass('max-h-24');
    });
});
