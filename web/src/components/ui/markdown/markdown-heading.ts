/**
 * The editor's heading node (ROK-1898): `#` / `##` / `###` only (`HUB_POST_MAX_HEADING_LEVEL`).
 * `@tiptap/extension-heading` is not a dependency, so this is a small node of its own.
 *
 * - Renders as `MD_HEADING_TAG[level]` (h3–h5) with `MD_CLASSES.h1–h3`, exactly like `MarkdownBlock`.
 *   The level also goes in `data-md-heading`, so copy/paste inside the editor keeps it (an h3 that
 *   is a level-1 heading must not parse back as level 3).
 * - Content is `text*` — no hard break: a stored heading is ONE line, and `# a  \nb` would read
 *   back as a heading plus a paragraph.
 * - `# ` / `## ` / `### ` at the start of a paragraph converts it (input rule). Inside a list item
 *   the rule cannot apply (items hold one paragraph), matching the contract: `- # x` is literal.
 */
import { Node, textblockTypeInputRule, type JSONContent, type MarkdownParseHelpers, type MarkdownRendererHelpers, type MarkdownToken } from '@tiptap/core';
import { HUB_POST_MAX_HEADING_LEVEL, type HubPostHeadingLevel } from '@raid-ledger/contract';
import { MD_CLASSES, MD_HEADING_TAG } from './markdown-classes';

/** A level attribute (or any value) as a valid post heading level; out-of-range clamps. */
export function headingLevel(value: unknown): HubPostHeadingLevel {
    if (value === 2 || value === 3) return value;
    return typeof value === 'number' && value > HUB_POST_MAX_HEADING_LEVEL ? 3 : 1;
}

/** `data-md-heading` → level, for the editor's own copy/paste. */
function levelFromData(el: HTMLElement): { level: HubPostHeadingLevel } {
    return { level: headingLevel(Number(el.getAttribute('data-md-heading'))) };
}

/** Stored markdown for one heading; an empty heading writes nothing (like an empty paragraph). */
function renderHeading(node: JSONContent, h: MarkdownRendererHelpers): string {
    const text = h.renderChildren(node.content ?? []).replace(/^[ \t]+/, '');
    if (text.trim() === '') return '';
    return `${'#'.repeat(headingLevel(node.attrs?.['level']))} ${text}`;
}

/** A GFM `heading` token (not reached by the load path, which escapes `#`): 1–3 → heading, else literal. */
function parseHeading(token: MarkdownToken, h: MarkdownParseHelpers) {
    const depth = typeof token['depth'] === 'number' ? token['depth'] : 0;
    if (depth >= 1 && depth <= HUB_POST_MAX_HEADING_LEVEL) {
        return h.createNode('heading', { level: headingLevel(depth) }, h.parseInline(token.tokens ?? []));
    }
    return h.createNode('paragraph', {}, [h.createTextNode((token.raw ?? '').replace(/\n+$/, ''))]);
}

export const PostHeading = Node.create({
    name: 'heading',
    group: 'block',
    content: 'text*',
    defining: true,
    addAttributes() {
        return { level: { default: 1, rendered: false } };
    },
    parseHTML() {
        return [
            { tag: '[data-md-heading]', priority: 60, getAttrs: levelFromData },
            { tag: 'h1', attrs: { level: 1 } },
            { tag: 'h2', attrs: { level: 2 } },
            { tag: 'h3', attrs: { level: 3 } },
        ];
    },
    renderHTML({ node }) {
        const level = headingLevel(node.attrs['level']);
        return [MD_HEADING_TAG[level], { class: MD_CLASSES[`h${level}`], 'data-md-heading': String(level) }, 0];
    },
    parseMarkdown: parseHeading,
    renderMarkdown: renderHeading,
    addInputRules() {
        return [textblockTypeInputRule({
            find: /^(#{1,3})\s$/,
            type: this.type,
            getAttributes: (match) => ({ level: headingLevel(match[1]?.length) }),
        })];
    },
    addKeyboardShortcuts() {
        const toggle = (level: HubPostHeadingLevel) => () => this.editor.commands.toggleNode(this.name, 'paragraph', { level });
        return { 'Mod-Alt-1': toggle(1), 'Mod-Alt-2': toggle(2), 'Mod-Alt-3': toggle(3) };
    },
});
