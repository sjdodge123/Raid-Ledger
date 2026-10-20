/**
 * The editor's explicit TipTap extension list (ROK-1868 spec D13/D14).
 *
 * The ProseMirror schema IS the allow-list: only the D14 subset is registered
 * (paragraph, hard break, bold, italic, strike, code, link, flat bullet and
 * numbered lists), so pasted headings/images/tables/underline cannot exist in
 * the document. Classes come from `MD_CLASSES` (D22) so the editor looks like
 * `MarkdownBlock`. Block tokens outside the subset (headings, quotes, code
 * blocks, rules, tables, HTML) parse as LITERAL paragraph text — the same way
 * `MarkdownBlock` renders them — instead of throwing and blanking the editor
 * (A6 probe: an unregistered token empties the document).
 */
import { Extension, type AnyExtension, type MarkdownToken, type MarkdownParseHelpers } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { isSafeMarkdownHref } from '@raid-ledger/contract';
import { MD_CLASSES } from './markdown-classes';

const LITERAL_BLOCK_TOKENS = ['heading', 'blockquote', 'code', 'hr', 'table', 'html', 'lheading'] as const;

/**
 * Inline tokens outside the subset that stay literal text. Stored `![alt](url)`
 * would otherwise load as just its alt text and the next save would drop the URL
 * (Codex P2). Pasted `<img>` HTML is still dropped by the schema — this is the
 * markdown-source path only.
 */
const LITERAL_INLINE_TOKENS = ['image'] as const;

function isInlineLiteral(token: MarkdownToken): boolean {
    return (token.type === 'html' && token.block === false) || (LITERAL_INLINE_TOKENS as readonly string[]).includes(token.type ?? '');
}

/** A token outside the subset → its source text, as a paragraph (block) or text (inline). */
function literalBlock(tokenName: string): AnyExtension {
    return Extension.create({
        name: `mdLiteral_${tokenName}`,
        markdownTokenName: tokenName,
        parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => {
            const raw = (token.raw ?? '').replace(/\n+$/, '');
            if (!raw.trim()) return [];
            const text = h.createTextNode(raw);
            return isInlineLiteral(token) ? text : h.createNode('paragraph', {}, [text]);
        },
    });
}

/** ListItem holding exactly one paragraph — flat lists (D14); Tab is NOT bound (no focus trap). */
const FlatListItem = ListItem.extend({
    content: 'paragraph',
    addKeyboardShortcuts() {
        return { Enter: () => this.editor.commands.splitListItem(this.name) };
    },
});

/** Mod-K hook: the editor component supplies the handler that opens the link row. */
export const LinkShortcut = Extension.create<{ onOpen: () => void }>({
    name: 'mdLinkShortcut',
    addOptions() { return { onOpen: () => undefined }; },
    addKeyboardShortcuts() {
        return { 'Mod-k': () => { this.options.onOpen(); return true; } };
    },
});

/**
 * Build the editor extension list.
 * @param opts.placeholder - placeholder text for an empty editor
 * @param opts.onLinkShortcut - called on Mod-K
 * @returns the TipTap extensions for `MarkdownEditor`
 */
export function buildMarkdownExtensions(opts: { placeholder?: string; onLinkShortcut: () => void }): AnyExtension[] {
    return [
        Document, Text, HardBreak, UndoRedo,
        Paragraph.configure({ HTMLAttributes: { class: MD_CLASSES.p } }),
        Bold.configure({ HTMLAttributes: { class: MD_CLASSES.strong } }),
        Italic.configure({ HTMLAttributes: { class: MD_CLASSES.em } }),
        Strike.configure({ HTMLAttributes: { class: MD_CLASSES.s } }),
        Code.configure({ HTMLAttributes: { class: MD_CLASSES.code } }),
        Link.configure({
            openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https',
            isAllowedUri: (url: string): boolean => isSafeMarkdownHref(url),
            HTMLAttributes: { class: MD_CLASSES.a, rel: 'noopener noreferrer', target: null },
        }),
        BulletList.configure({ HTMLAttributes: { class: MD_CLASSES.ul } }),
        OrderedList.configure({ HTMLAttributes: { class: MD_CLASSES.ol } }),
        FlatListItem.configure({ HTMLAttributes: { class: MD_CLASSES.li } }),
        Placeholder.configure({ placeholder: opts.placeholder ?? '' }),
        LinkShortcut.configure({ onOpen: opts.onLinkShortcut }),
        Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
        ...[...LITERAL_BLOCK_TOKENS, ...LITERAL_INLINE_TOKENS].map(literalBlock),
    ];
}
