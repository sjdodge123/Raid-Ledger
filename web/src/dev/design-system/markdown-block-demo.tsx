/**
 * Markdown render demos for /dev/design-system (ROK-1868): a `MarkdownBlock`
 * sample of every allowed element of the hub-post subset (D14), the literal
 * fallbacks, and `CharCounter` under / near / over its limit. Mounts the REAL
 * components — check the link green and the code chip in default-dark AND
 * default-light (the side-by-side toggle renders this twice).
 */
import type { JSX } from 'react';
import { MarkdownBlock } from '../../components/ui/markdown-block';
import { CharCounter } from '../../components/ui/char-counter';
import { StateFrame } from './design-system-bits';

const SAMPLE = [
    'Raid night is **Thursday**, *pull at 8*, ~~Wednesday~~ is off.',
    'Bring `flasks` and read [the guide](/guides/raid) or <https://example.com/strat>.',
    'A single newline is a line break —\nlike this.',
    '',
    '- Tanks: soak the frontal',
    '- Healers: **[cooldown sheet](/sheets/1)**',
    '',
    '3. Pull',
    '4. Burn',
].join('\n');

const LITERALS = '# not a heading\n> not a quote\n![not an image](https://example.com/p.png)\n<b>not html</b> [unsafe](javascript:alert(1))';

/** MarkdownBlock + CharCounter state frames for the Forms grid. */
export function MarkdownStates(): JSX.Element {
    return (
        <>
            <StateFrame label="MarkdownBlock — every allowed element" note="Paragraphs, <br>, bold / italic / strike / code, safe links (also nested in bold), flat bullet + numbered (start=3) lists. Classes = MD_CLASSES, shared with the editor.">
                <MarkdownBlock text={SAMPLE} className="w-full text-sm" testId="ds-markdown-block" />
            </StateFrame>
            <StateFrame label="MarkdownBlock — literal fallbacks" note="Headings, quotes, images, raw HTML and unsafe hrefs render as plain text — never as elements.">
                <MarkdownBlock text={LITERALS} className="w-full text-sm" testId="ds-markdown-literals" />
            </StateFrame>
            <StateFrame label="CharCounter — under / near / over" note="text-dim, then text-danger over max. The sr-only polite region speaks only near or past the limit.">
                <div className="w-full">
                    <CharCounter id="ds-cc-1" length={120} max={4000} testId="ds-cc-under" />
                    <CharCounter id="ds-cc-2" length={3990} max={4000} testId="ds-cc-near" />
                    <CharCounter id="ds-cc-3" length={4012} max={4000} testId="ds-cc-over" />
                </div>
            </StateFrame>
        </>
    );
}
