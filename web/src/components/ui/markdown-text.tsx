import type { JSX } from 'react';

interface Props {
    text: string;
    className?: string;
}

type Token =
    | { kind: 'text'; value: string }
    | { kind: 'bold'; value: string }
    | { kind: 'italic'; value: string }
    | { kind: 'code'; value: string }
    | { kind: 'link'; text: string; href: string };

const PATTERN =
    /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))/g;

function parseInline(line: string): Token[] {
    const tokens: Token[] = [];
    let lastIdx = 0;
    for (const match of line.matchAll(PATTERN)) {
        const [raw] = match;
        const idx = match.index ?? 0;
        if (idx > lastIdx) tokens.push({ kind: 'text', value: line.slice(lastIdx, idx) });
        if (raw.startsWith('**')) tokens.push({ kind: 'bold', value: raw.slice(2, -2) });
        else if (raw.startsWith('`')) tokens.push({ kind: 'code', value: raw.slice(1, -1) });
        else if (raw.startsWith('[')) {
            const closeBracket = raw.indexOf('](');
            const text = raw.slice(1, closeBracket);
            const href = raw.slice(closeBracket + 2, -1);
            if (/^https?:\/\//.test(href) || href.startsWith('/')) {
                tokens.push({ kind: 'link', text, href });
            } else {
                tokens.push({ kind: 'text', value: raw });
            }
        } else tokens.push({ kind: 'italic', value: raw.slice(1, -1) });
        lastIdx = idx + raw.length;
    }
    if (lastIdx < line.length) tokens.push({ kind: 'text', value: line.slice(lastIdx) });
    return tokens;
}

function renderToken(token: Token, i: number): JSX.Element | string {
    switch (token.kind) {
        case 'bold':
            return <strong key={i}>{token.value}</strong>;
        case 'italic':
            return <em key={i}>{token.value}</em>;
        case 'code':
            return (
                <code key={i} className="px-1 rounded bg-surface/60 text-xs">
                    {token.value}
                </code>
            );
        case 'link':
            return (
                <a
                    key={i}
                    href={token.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                >
                    {token.text}
                </a>
            );
        default:
            return token.value;
    }
}

/**
 * Minimal markdown renderer (ROK-1063).
 * Supports: **bold**, *italic*, `code`, [link](url), line breaks.
 * Raw HTML is NOT rendered — only the allow-listed inline tokens above.
 */
export function MarkdownText({ text, className }: Props): JSX.Element {
    const lines = text.split(/\r?\n/);
    return (
        <div className={className}>
            {lines.map((line, li) => (
                <p key={li} className="text-sm text-muted whitespace-pre-wrap">
                    {parseInline(line).map((tok, ti) => renderToken(tok, ti))}
                </p>
            ))}
        </div>
    );
}
