/**
 * ROK-1483 AC3 — hostile content never renders HTML or script.
 *
 * The highest-value test in the story. Every row asserts BOTH halves of the
 * safety claim: the `Token[]` the tokenizer produced, and the DOM `DiscordText`
 * built from it. Asserting only tokens would pass even if the renderer grew a
 * raw-HTML escape hatch; asserting only DOM would pass if the fixture never
 * reached the renderer at all.
 *
 * There is no JSX here on purpose — the spec names this file `.test.ts`, so the
 * one render goes through `createElement`.
 */
import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ThreadMessageMentionDto } from '@raid-ledger/contract';
import { tokenize, isHttpUrl, type Token } from './discord-markdown.helpers';
import { DiscordText } from './DiscordText';

interface Rendered {
    tokens: Token[];
    container: HTMLElement;
}

/** Tokenize + render in one step, so no case can assert one half only. */
function renderContent(content: string, mentions: ThreadMessageMentionDto[] = []): Rendered {
    const tokens = tokenize(content, mentions);
    const { container } = render(createElement(DiscordText, { tokens }));
    return { tokens, container };
}

const ACTIVE_TAGS = ['script', 'iframe', 'object', 'embed', 'img', 'svg', 'style'];
const HOSTILE_PROTOCOL = /^\s*(javascript|data|vbscript):/i;

/**
 * The universal safety assertion.
 *
 * NB: this deliberately does NOT grep `innerHTML` for the substrings
 * `onerror=` or `javascript:`. Rendering `<img src=x onerror=alert(1)>` as
 * ESCAPED TEXT is the correct, safe outcome, and that escaped text legitimately
 * contains `onerror=` — a substring check would fail on the very behaviour it
 * is meant to protect, and the only way to make it pass would be to stop
 * showing the user their own message. What actually matters is structural:
 * no active element exists, no attribute carries a hostile protocol, and no
 * unescaped tag was emitted. Do not "simplify" this back to a substring grep.
 */
function expectInert(container: HTMLElement): void {
    expect(container.innerHTML).not.toContain('<script');
    for (const element of Array.from(container.querySelectorAll('*'))) {
        expect(
            ACTIVE_TAGS.includes(element.tagName.toLowerCase()),
            `no active element may be rendered, found <${element.tagName.toLowerCase()}>`,
        ).toBe(false);
        for (const attr of Array.from(element.attributes)) {
            expect(attr.name.startsWith('on'), `event attribute ${attr.name} rendered`).toBe(false);
            expect(
                HOSTILE_PROTOCOL.test(attr.value),
                `attribute ${attr.name} carries a hostile protocol: ${attr.value}`,
            ).toBe(false);
        }
    }
}

const ALICE: ThreadMessageMentionDto[] = [
    { id: '123', kind: 'user', displayName: 'Alice' },
];

interface HostileCase {
    name: string;
    content: string;
    mentions?: ThreadMessageMentionDto[];
    assert: (rendered: Rendered) => void;
}

const CASES: HostileCase[] = [
    {
        name: 'a raw <script> tag is one text token and never an element',
        content: '<script>alert(1)</script>',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }]);
            expect(container.querySelector('script')).toBeNull();
            expect(container.textContent).toBe('<script>alert(1)</script>');
        },
    },
    {
        name: 'an <img onerror> payload produces no img element and no handler',
        content: '<img src=x onerror=alert(1)>',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
            expect(container.querySelector('img')).toBeNull();
            expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
        },
    },
    {
        name: 'a javascript: markdown link builds NO anchor',
        content: '[click](javascript:alert(1))',
        assert: ({ tokens, container }) => {
            expect(tokens.some((t) => t.kind === 'link')).toBe(false);
            const anchor = container.querySelector('a');
            expect(
                anchor ? anchor.getAttribute('href') : null,
                'a non-http protocol must never become an anchor',
            ).toBeNull();
            expect(container.textContent).toContain('[click](javascript:alert(1)');
        },
    },
    {
        name: 'a data:text/html markdown link builds NO anchor',
        content: '[click](data:text/html,<script>x</script>)',
        assert: ({ tokens, container }) => {
            expect(tokens.some((t) => t.kind === 'link')).toBe(false);
            const anchor = container.querySelector('a');
            expect(
                anchor ? anchor.getAttribute('href') : null,
                'data: is not on the allow-list',
            ).toBeNull();
        },
    },
    {
        name: 'an https markdown link builds a hardened anchor',
        content: '[click](https://evil.test)',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([
                { kind: 'link', href: 'https://evil.test', label: 'click' },
            ]);
            const anchor = container.querySelector('a');
            expect(anchor).not.toBeNull();
            expect(anchor?.getAttribute('href')).toBe('https://evil.test');
            expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
            expect(anchor?.getAttribute('target')).toBe('_blank');
            expect(anchor?.textContent).toBe('click');
        },
    },
    {
        name: 'a bare https url is autolinked with the same hardening',
        content: 'see https://ok.test/x now',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([
                { kind: 'text', text: 'see ' },
                { kind: 'link', href: 'https://ok.test/x', label: 'https://ok.test/x' },
                { kind: 'text', text: ' now' },
            ]);
            const anchor = container.querySelector('a');
            expect(anchor?.getAttribute('href')).toBe('https://ok.test/x');
            expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
            expect(anchor?.getAttribute('target')).toBe('_blank');
        },
    },
    {
        name: 'markup inside bold stays inside the bold TEXT',
        content: '**bold<script>**',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([{ kind: 'bold', text: 'bold<script>' }]);
            expect(container.querySelector('script')).toBeNull();
            expect(container.querySelector('strong')?.textContent).toBe('bold<script>');
        },
    },
    {
        name: 'markup inside inline code stays inside the code TEXT',
        content: '`<b>x</b>`',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([{ kind: 'code', text: '<b>x</b>' }]);
            expect(container.querySelector('b')).toBeNull();
            expect(container.querySelector('code')?.textContent).toBe('<b>x</b>');
        },
    },
    {
        name: 'a resolved user mention renders the stored display name only',
        content: 'hi <@123>',
        mentions: ALICE,
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([
                { kind: 'text', text: 'hi ' },
                { kind: 'mention', mentionKind: 'user', id: '123', display: '@Alice' },
            ]);
            expect(container.textContent).toBe('hi @Alice');
            expect(container.innerHTML).not.toContain('@123');
            expect(container.innerHTML).not.toContain('123');
        },
    },
    {
        name: 'an unresolved mention renders @unknown, never the raw marker',
        content: '<@999>',
        assert: ({ tokens, container }) => {
            expect(tokens).toEqual([
                { kind: 'mention', mentionKind: 'user', id: '999', display: '@unknown' },
            ]);
            expect(container.textContent).toBe('@unknown');
            expect(container.innerHTML).not.toContain('999');
        },
    },
    {
        name: 'a 5000-character single word renders inside a break-words wrapper',
        content: 'a'.repeat(5000),
        assert: ({ tokens, container }) => {
            expect(tokens).toHaveLength(1);
            expect(container.textContent).toHaveLength(5000);
            const wrapper = container.querySelector('[data-testid="discord-text"]');
            expect(wrapper?.className).toContain('break-words');
        },
    },
];

describe('tokenize + DiscordText — hostile content (AC3)', () => {
    for (const hostile of CASES) {
        it(hostile.name, () => {
            const rendered = renderContent(hostile.content, hostile.mentions ?? []);
            hostile.assert(rendered);
            expectInert(rendered.container);
        });
    }
});

describe('isHttpUrl — the allow-list itself', () => {
    it.each([
        ['https://ok.test', true],
        ['http://ok.test', true],
        ['javascript:alert(1)', false],
        ['data:text/html,x', false],
        ['vbscript:msgbox', false],
        ['//evil.test', false],
        ['not a url', false],
    ])('%s -> %s', (raw, expected) => {
        expect(isHttpUrl(raw as string)).toBe(expected);
    });
});

describe('tokenize — the supported subset (D7)', () => {
    it('keeps italics, strike, quotes and fences apart', () => {
        expect(tokenize('*i*')).toEqual([{ kind: 'italic', text: 'i' }]);
        expect(tokenize('_i_')).toEqual([{ kind: 'italic', text: 'i' }]);
        expect(tokenize('~~s~~')).toEqual([{ kind: 'strike', text: 's' }]);
        expect(tokenize('> quoted **b**')).toEqual([
            {
                kind: 'quote',
                children: [
                    { kind: 'text', text: 'quoted ' },
                    { kind: 'bold', text: 'b' },
                ],
            },
        ]);
        expect(tokenize('```ts\nconst x = 1;\n```')).toEqual([
            { kind: 'codeblock', text: 'const x = 1;\n', language: 'ts' },
        ]);
    });

    it('resolves role and channel mentions and flattens custom emoji', () => {
        const mentions: ThreadMessageMentionDto[] = [
            { id: '7', kind: 'role', displayName: 'Raiders' },
            { id: '8', kind: 'channel', displayName: 'general' },
        ];
        expect(tokenize('<@&7> <#8> <:wave:99> <a:spin:98>', mentions)).toEqual([
            { kind: 'mention', mentionKind: 'role', id: '7', display: '@Raiders' },
            { kind: 'text', text: ' ' },
            { kind: 'mention', mentionKind: 'channel', id: '8', display: '#general' },
            { kind: 'text', text: ' :wave: :spin:' },
        ]);
    });
});
