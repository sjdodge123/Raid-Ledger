/**
 * MarkdownInline — renders one line of inline Markdown (ROK-1868 D15), the
 * shared tokenizer under `MarkdownText` and `MarkdownBlock`.
 *
 * React elements only — never `dangerouslySetInnerHTML`. Raw HTML in the
 * source is text. Links come only from hrefs that pass the contract's
 * `isSafeMarkdownHref` and open in a new tab with `rel="noopener noreferrer"`.
 * Classes come from `MD_CLASSES`, so the editor and the reader match.
 */
import type { JSX, ReactNode } from 'react';
import { MD_CLASSES } from './markdown/markdown-classes';
import { parseInline, type InlineNode } from './markdown/markdown-inline-parse';

export interface MarkdownInlineProps {
    /** One line of Markdown source (no newlines — split blocks first). */
    text: string;
    /** Render `~~strike~~` (default `true`). */
    strike?: boolean;
    /** Render `<https://…>` autolinks (default `true`). */
    autolink?: boolean;
}

function renderNodes(nodes: InlineNode[]): ReactNode[] {
    return nodes.map((node, i) => renderNode(node, i));
}

function renderNode(node: InlineNode, key: number): ReactNode {
    switch (node.kind) {
        case 'text':
            return node.value;
        case 'code':
            return <code key={key} className={MD_CLASSES.code}>{node.value}</code>;
        case 'strong':
            return <strong key={key} className={MD_CLASSES.strong}>{renderNodes(node.children)}</strong>;
        case 'em':
            return <em key={key} className={MD_CLASSES.em}>{renderNodes(node.children)}</em>;
        case 's':
            return <s key={key} className={MD_CLASSES.s}>{renderNodes(node.children)}</s>;
        case 'link':
            return (
                <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className={MD_CLASSES.a}>
                    {renderNodes(node.children)}
                </a>
            );
    }
}

/** One line of safe inline Markdown, as a fragment — wrap it in your own `<p>`/`<li>`. */
export function MarkdownInline({ text, strike = true, autolink = true }: MarkdownInlineProps): JSX.Element {
    return <>{renderNodes(parseInline(text, { strike, autolink }))}</>;
}
