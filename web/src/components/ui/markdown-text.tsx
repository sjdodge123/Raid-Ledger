import type { JSX } from 'react';
import { MarkdownInline } from './markdown-inline';

interface Props {
    text: string;
    className?: string;
}

/**
 * Minimal markdown renderer (ROK-1063), one `<p>` per line.
 * Supports: **bold**, *italic*, `code`, [link](url), line breaks.
 * Raw HTML is NOT rendered — only the allow-listed inline tokens above.
 *
 * Runs on the shared inline tokenizer (`MarkdownInline`, ROK-1868) with
 * strike and autolinks off, so this token set is unchanged. Link safety
 * (ROK-1077: http(s) or single-slash app-relative only; protocol-relative,
 * backslash, whitespace and control characters rejected) is the contract's
 * `isSafeMarkdownHref` — an unsafe link renders as its raw text.
 * For multi-paragraph text with lists, use `MarkdownBlock`.
 */
export function MarkdownText({ text, className }: Props): JSX.Element {
    const lines = text.split(/\r?\n/);
    return (
        <div className={className}>
            {lines.map((line, li) => (
                <p key={li} className="text-sm text-muted whitespace-pre-wrap">
                    <MarkdownInline text={line} strike={false} autolink={false} />
                </p>
            ))}
        </div>
    );
}
