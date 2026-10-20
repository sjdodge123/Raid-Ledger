/**
 * MarkdownBlock — block-level renderer for the hub-post Markdown subset
 * (ROK-1868 D14/D15): paragraphs (blank line), line breaks (single newline),
 * flat bullet and numbered lists, and the inline set of `MarkdownInline`
 * (bold, italic, strike, code, safe links). Headings, quotes, images, tables
 * and raw HTML render as literal text.
 *
 * React elements only — never `dangerouslySetInnerHTML`. Classes come from
 * `MD_CLASSES` (shared with the editor). The root sets no text size or
 * height: pass `className` (e.g. `text-sm`, a height clamp).
 */
import { Fragment, useMemo, type JSX } from 'react';
import { MarkdownInline } from './markdown-inline';
import { MD_CLASSES } from './markdown/markdown-classes';
import { parseBlocks, type MarkdownBlockNode } from './markdown/markdown-block-parse';

export interface MarkdownBlockProps {
    /** Markdown source (stored post body). */
    text: string;
    /** Extra classes on the root `<div>`. */
    className?: string;
    /** `data-testid` on the root `<div>`. */
    testId?: string;
}

/** Lines of inline Markdown separated by `<br>`. */
function Lines({ lines }: { lines: string[] }): JSX.Element {
    return (
        <>
            {lines.map((line, i) => (
                <Fragment key={i}>
                    {i > 0 && <br />}
                    <MarkdownInline text={line} />
                </Fragment>
            ))}
        </>
    );
}

function renderItems(items: string[][]): JSX.Element[] {
    return items.map((lines, i) => (
        <li key={i} className={MD_CLASSES.li}><Lines lines={lines} /></li>
    ));
}

function renderBlock(block: MarkdownBlockNode, key: number): JSX.Element {
    if (block.kind === 'p') return <p key={key} className={MD_CLASSES.p}><Lines lines={block.lines} /></p>;
    if (block.kind === 'ul') return <ul key={key} className={MD_CLASSES.ul}>{renderItems(block.items)}</ul>;
    const start = block.start === 1 ? {} : { start: block.start };
    return <ol key={key} {...start} className={MD_CLASSES.ol}>{renderItems(block.items)}</ol>;
}

/** Safe multi-paragraph Markdown. See the file header for the subset. */
export function MarkdownBlock({ text, className, testId }: MarkdownBlockProps): JSX.Element {
    const blocks = useMemo(() => parseBlocks(text), [text]);
    const cls = ['space-y-2 whitespace-pre-wrap break-words', className ?? ''].filter(Boolean).join(' ');
    return (
        <div data-testid={testId} className={cls}>
            {blocks.map(renderBlock)}
        </div>
    );
}
