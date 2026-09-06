/**
 * ROK-1483 D7 — renders a `Token[]` as React elements.
 *
 * This is the ONLY place in the Discord viewer that builds an `<a>`, and it
 * re-checks the protocol allow-list even though `tokenize` already did
 * (defence in depth: a future caller could hand-build a token list). Every
 * other token becomes a text node, which React escapes — no component under
 * this folder may use raw-HTML injection, and a source-scanning guard test
 * pins that (D15 / AC4).
 */
import type { JSX } from 'react';
import { isHttpUrl, type Token } from './discord-markdown.helpers';

export interface DiscordTextProps {
    /** Tokens from `tokenize(content, mentions)`. */
    tokens: Token[];
    /** Extra classes for the wrapper; the safety-relevant ones are always applied. */
    className?: string;
}

/** Anchor styling + the hardening every outbound link carries. */
const LINK_CLASS = 'text-primary underline underline-offset-2 hover:no-underline';

/** One token → one element. Returns `null` only for an unrenderable link. */
function renderToken(token: Token, key: number): JSX.Element | string | null {
    switch (token.kind) {
        case 'text':
            return token.text;
        case 'bold':
            return <strong key={key}>{token.text}</strong>;
        case 'italic':
            return <em key={key}>{token.text}</em>;
        case 'strike':
            return <s key={key}>{token.text}</s>;
        case 'code':
            return (
                <code key={key} className="rounded bg-overlay px-1 font-mono text-xs">
                    {token.text}
                </code>
            );
        case 'codeblock':
            return (
                <pre
                    key={key}
                    className="my-1 overflow-x-auto rounded-lg bg-overlay p-2 font-mono text-xs"
                >
                    <code>{token.text}</code>
                </pre>
            );
        case 'quote':
            return (
                <blockquote key={key} className="my-1 border-l-2 border-muted/40 pl-2 text-muted">
                    {token.children.map((child, index) => renderToken(child, index))}
                </blockquote>
            );
        case 'mention':
            return (
                <span
                    key={key}
                    data-testid="discord-mention"
                    className="rounded bg-overlay px-1 py-0.5 text-xs font-medium text-foreground"
                >
                    {token.display}
                </span>
            );
        case 'link':
            return renderLink(token.href, token.label, key);
        default:
            return null;
    }
}

/**
 * Builds an anchor only for an allow-listed protocol; anything else degrades to
 * the label as plain text rather than silently disappearing.
 */
function renderLink(href: string, label: string, key: number): JSX.Element | string {
    if (!isHttpUrl(href)) return label;
    return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {label}
        </a>
    );
}

/**
 * Safe renderer for Discord message content.
 *
 * @param props tokens to render plus optional wrapper classes
 * @returns a wrapper that preserves newlines and breaks unbroken 5k-char words
 */
export function DiscordText({ tokens, className }: DiscordTextProps): JSX.Element {
    return (
        <div
            data-testid="discord-text"
            className={`whitespace-pre-wrap break-words text-sm text-foreground${className ? ` ${className}` : ''}`}
        >
            {tokens.map((token, index) => renderToken(token, index))}
        </div>
    );
}
