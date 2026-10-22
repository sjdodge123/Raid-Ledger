/**
 * Stored inline HTML loads as LITERAL text (ROK-1868 Codex r4).
 *
 * `@tiptap/markdown` parses marked's inline `html` tokens itself (it merges an
 * open/close pair and runs it through the schema's `parseHTML`), so no token
 * handler can intercept them: legacy `Before <img src=x> after` loaded as
 * `Before  after` and `<b>text</b>` as bold, and the next unrelated edit
 * rewrote the stored post. This inline tokenizer runs before marked's built-in
 * one and claims every CommonMark raw-HTML span as a `mdLiteralInlineHtml`
 * token, which parses to a plain text node — the same way `MarkdownBlock`
 * shows it. It is the markdown-load path only; clipboard HTML is sanitised by
 * the schema as before. Autolinks (`<https://…>`) never match: a tag name
 * stops at `:`.
 */
import { Extension, type MarkdownParseHelpers, type MarkdownToken } from '@tiptap/core';

const ATTR = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`;
const INLINE_HTML = new RegExp(
    [
        String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${ATTR})*\s*\/?>`,
        String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`,
        String.raw`<!--[\s\S]*?-->`,
        String.raw`<\?[\s\S]*?\?>`,
        String.raw`<!\[CDATA\[[\s\S]*?\]\]>`,
        String.raw`<![A-Za-z][^>]*>`,
    ].map((alt: string): string => `^(?:${alt})`).join('|'),
);

/** Match a raw-HTML span at the very start of `src`. */
export function matchInlineHtml(src: string): string | null {
    return INLINE_HTML.exec(src)?.[0] ?? null;
}

/** The TipTap extension that keeps stored inline HTML as literal text. */
export const LiteralInlineHtml = Extension.create({
    name: 'mdLiteralInlineHtml',
    markdownTokenName: 'mdLiteralInlineHtml',
    markdownTokenizer: {
        name: 'mdLiteralInlineHtml',
        level: 'inline',
        start: '<',
        tokenize: (src: string): MarkdownToken | undefined => {
            const raw = matchInlineHtml(src);
            return raw ? { type: 'mdLiteralInlineHtml', raw, text: raw } : undefined;
        },
    },
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => h.createTextNode(token.raw ?? ''),
});
