/**
 * Semantic colour tokens for /dev/design-system (ROK-1586 §5.1).
 *
 * `success` / `warning` / `danger` became tokens in ROK-1586; `busy` and `slot`
 * already were (ROK-1584 / ROK-1587). Every swatch paints via the exact class
 * named in its own row, so a wrong claim shows up visually. Class strings are
 * spelled out literally (Tailwind only generates classes it sees verbatim).
 *
 * The hexes are transcribed from `web/src/index.css` — the `@theme` block
 * (`:50-62`) and the shared light `:is(...)` block (`:114-122`). They are the
 * sanctioned exception to "never hardcode a colour": text, not paint.
 */
import type { JSX } from 'react';
import { Section, StateFrame, SideBySide, DoBlock, DontBlock } from './design-system-bits';

interface SemanticRow {
    name: string;
    solid: string;
    border: string;
    tint: string;
    text: string;
    dark: string;
    light: string;
    role: string;
}

const SEMANTIC_ROWS: SemanticRow[] = [
    { name: 'success', solid: 'bg-success', border: 'border-success/30', tint: 'bg-success/10', text: 'text-success',
        dark: '#10b981', light: '#047857', role: 'Free · confirmed · primary action' },
    { name: 'warning', solid: 'bg-warning', border: 'border-warning/30', tint: 'bg-warning/10', text: 'text-warning',
        dark: '#f59e0b', light: '#b45309', role: 'Partial agreement · needs attention · admin' },
    { name: 'danger', solid: 'bg-danger', border: 'border-danger/30', tint: 'bg-danger/10', text: 'text-danger',
        dark: '#ef4444', light: '#dc2626', role: 'Conflict · destructive · "few free"' },
    { name: 'busy', solid: 'bg-busy', border: 'border-busy/30', tint: 'bg-busy/10', text: 'text-busy',
        dark: '#8b5cf6', light: '#7c3aed', role: 'Someone is committed elsewhere this hour' },
    { name: 'slot', solid: 'bg-slot', border: 'border-slot/30', tint: 'bg-slot/10', text: 'text-slot',
        dark: '#22d3ee', light: '#0e7490', role: 'A time someone already proposed in a poll' },
];

const CHIP = 'w-8 h-8 rounded-md';

/** One token: solid chip, `/30` border, `/10` tint, text shade — then its two hexes. */
function SemanticSwatchRow({ row }: { row: SemanticRow }): JSX.Element {
    return (
        <tr className="border-t border-edge-subtle" data-testid={`ds-semantic-${row.name}`}>
            <td className="py-2 pr-3"><code className={`text-xs ${row.text}`}>--color-{row.name}</code></td>
            <td className="py-2 pr-3">
                <div className="flex items-center gap-1.5">
                    <span className={`${CHIP} ${row.solid}`} title={row.solid} />
                    <span className={`${CHIP} bg-panel border-4 ${row.border}`} title={row.border} />
                    <span className={`${CHIP} border border-edge ${row.tint}`} title={row.tint} />
                    <span className={`text-sm font-semibold ${row.text}`} title={row.text}>Aa</span>
                </div>
            </td>
            <td className="py-2 pr-3 font-mono text-[11px] text-muted">{row.dark}</td>
            <td className="py-2 pr-3 font-mono text-[11px] text-muted">{row.light}</td>
            <td className="py-2 text-[11px] text-dim">{row.role}</td>
        </tr>
    );
}

function SemanticTable(): JSX.Element {
    return (
        <table className="w-full text-sm mb-6">
            <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted text-left">
                    <th className="py-1 pr-3 font-medium">Token</th>
                    <th className="py-1 pr-3 font-medium">Solid · /30 border · /10 tint · text</th>
                    <th className="py-1 pr-3 font-medium">Dark</th>
                    <th className="py-1 pr-3 font-medium">Light</th>
                    <th className="py-1 font-medium">Role</th>
                </tr>
            </thead>
            <tbody>{SEMANTIC_ROWS.map((row) => <SemanticSwatchRow key={row.name} row={row} />)}</tbody>
        </table>
    );
}

const BUTTON = 'px-3 py-1 text-xs rounded text-foreground';

/**
 * Rule D-6: a SOLID button fill stays a raw hue. `index.css:785-790` forces the
 * white label off `.bg-emerald-600.text-foreground` on the six light schemes;
 * `bg-success` is not in that list, so its label goes near-black there.
 */
function ButtonFillComparison(): JSX.Element {
    return (
        <SideBySide>
            <DoBlock title="solid button fill stays a raw hue (D-6)">
                <StateFrame label="bg-emerald-600 text-foreground" note="Label forced white on every light scheme.">
                    <button type="button" className={`${BUTTON} bg-emerald-600`} data-testid="ds-button-raw">Lock in</button>
                </StateFrame>
            </DoBlock>
            <DontBlock title="tokenise a solid button fill">
                <StateFrame label="bg-success text-foreground" note="No forced-white rule — dark label on light schemes.">
                    <button type="button" className={`${BUTTON} bg-success`} data-testid="ds-button-token">Lock in</button>
                </StateFrame>
            </DontBlock>
        </SideBySide>
    );
}

/** The five semantic tokens plus the one place NOT to use them. */
export function SemanticTokensSection(): JSX.Element {
    return (
        <Section
            id="semantic"
            title="Semantic colour tokens"
            blurb="Use bg-success / text-warning / border-danger for the MEANING — the token is what a scheme repaints. The opacity modifier works at any alpha. Raw hues stay legal only for categorical accents and solid button fills."
        >
            <SemanticTable />
            <ButtonFillComparison />
        </Section>
    );
}
