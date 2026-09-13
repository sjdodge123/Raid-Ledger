/**
 * Accent hues, dark shade vs light shade (ROK-1539).
 *
 * This is the rendered home of what used to be a table in
 * docs/design-system.md §2.2 — the doc links here rather than carrying it, so
 * the mapping is read where it can actually be *seen* in both families (turn on
 * "Side by side" and every swatch below renders twice).
 *
 * You write ONE class; `index.css:640-652` rewrites it for the six light
 * schemes. The literal hexes below are documented values, the sanctioned
 * exception to "never hardcode a colour" — every swatch itself paints via the
 * Tailwind class named in its own row, so a wrong claim shows up visually.
 */
import type { JSX } from 'react';
import { Section } from './design-system-bits';

interface AccentRow {
    cls: string;
    dark: string;
    light: string;
    note: string;
}

/** Text accents. `light` is what `index.css` repaints them as under a light scheme. */
const TEXT_ACCENTS: AccentRow[] = [
    { cls: 'text-emerald-400', dark: '#34d399', light: '#059669', note: 'emerald-600 · 4.5:1 · :646' },
    { cls: 'text-emerald-300', dark: '#6ee7b7', light: '#059669', note: 'emerald-600 · :647' },
    { cls: 'text-emerald-500', dark: '#10b981', light: '#047857', note: 'emerald-700 · 6.0:1 · :648' },
    { cls: 'text-red-400', dark: '#f87171', light: '#dc2626', note: 'red-600 · 4.6:1 · :640' },
    { cls: 'text-amber-400', dark: '#fbbf24', light: '#d97706', note: 'amber-600 · 4.3:1 · :641' },
    { cls: 'text-amber-300', dark: '#fcd34d', light: '#fcd34d', note: 'NO override — ≈1.4:1 on white · §6.9' },
    { cls: 'text-yellow-400', dark: '#facc15', light: '#ca8a04', note: 'yellow-600 · :642' },
    { cls: 'text-green-400', dark: '#4ade80', light: '#16a34a', note: 'green-600 · :644' },
    { cls: 'text-purple-400', dark: '#c084fc', light: '#7c3aed', note: 'violet-600 · 5.2:1 · :649' },
    { cls: 'text-indigo-400', dark: '#818cf8', light: '#4f46e5', note: 'indigo-600 · 5.9:1 · :650' },
    { cls: 'text-cyan-400', dark: '#22d3ee', light: '#0891b2', note: 'cyan-600 · 4.5:1 · :652' },
    { cls: 'text-blue-400', dark: '#60a5fa', light: '#60a5fa', note: 'NO override — ≈2.5:1 on white · §6.9' },
];

function AccentTextRow({ row }: { row: AccentRow }): JSX.Element {
    return (
        <tr className="border-t border-edge-subtle" data-testid={`ds-accent-${row.cls}`}>
            <td className="py-1.5 pr-3"><code className={`text-xs ${row.cls}`}>{row.cls}</code></td>
            <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{row.dark}</td>
            <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{row.light}</td>
            <td className="py-1.5 text-[11px] text-dim">{row.note}</td>
        </tr>
    );
}

function AccentTextTable(): JSX.Element {
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted text-left">
                    <th className="py-1 pr-3 font-medium">Class (painted live)</th>
                    <th className="py-1 pr-3 font-medium">Dark</th>
                    <th className="py-1 pr-3 font-medium">Light</th>
                    <th className="py-1 font-medium">index.css</th>
                </tr>
            </thead>
            <tbody>
                {TEXT_ACCENTS.map((row) => <AccentTextRow key={row.cls} row={row} />)}
            </tbody>
        </table>
    );
}

/** Tinted surfaces: `-500/10` fill + `-500/30` border, remapped at `:672-694` / `:708-720`. */
function TintedSurfaces(): JSX.Element {
    const hues = ['emerald', 'amber', 'red', 'indigo'];
    return (
        <div className="flex flex-wrap gap-2">
            {hues.map((hue) => (
                <span
                    key={hue}
                    data-testid={`ds-accent-tint-${hue}`}
                    className={`px-3 py-1.5 rounded-lg text-xs bg-${hue}-500/10 border border-${hue}-500/30 text-${hue}-400`}
                >
                    {hue}-500/10
                </span>
            ))}
        </div>
    );
}

/** Solid fills: same fill in both families; `:744-750` forces white label text on light. */
function SolidFills(): JSX.Element {
    return (
        <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-foreground">
                bg-emerald-600 + text-foreground
            </button>
            <button type="button" className="min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-foreground">
                bg-indigo-600
            </button>
            <button type="button" className="min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium bg-red-600 text-foreground">
                bg-red-600
            </button>
        </div>
    );
}

/** Accent-hue reference: every shade in its dark and light rendering. */
export function AccentsSection(): JSX.Element {
    return (
        <Section
            id="accents"
            title="Accent hues"
            blurb="One class, two paintings. Semantic accents are raw Tailwind hues; the light family repaints them in index.css. Two of them are not repainted at all — those rows are the bug, not the pattern."
        >
            <div className="bg-panel/50 border border-edge rounded-lg p-3 mb-4 overflow-x-auto">
                <AccentTextTable />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="bg-panel/50 border border-edge rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Tinted surface — remapped on light</div>
                    <TintedSurfaces />
                </div>
                <div className="bg-panel/50 border border-edge rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Solid fill — identical on both, label forced white</div>
                    <SolidFills />
                </div>
            </div>
        </Section>
    );
}
