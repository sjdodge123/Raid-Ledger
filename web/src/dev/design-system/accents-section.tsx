/**
 * Accent hues, dark shade vs light shade (ROK-1539).
 *
 * This is the rendered home of what used to be a table in
 * docs/design-system.md §2.2 — the doc links here rather than carrying it, so
 * the mapping is read where it can actually be *seen* in both families (turn on
 * "Side by side" and every swatch below renders twice).
 *
 * You write ONE class; `index.css:687-704` rewrites it for the six light
 * schemes, to a shade that clears 4.5:1 on the surface, the panel and the hue's
 * own -500/10 tint (`styles/raw-hue-light.guard.test.ts` enforces it). The literal hexes below are documented values, the sanctioned
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

/** Text accents. `light` is what `index.css` repaints them as under a light scheme; ratios are surface / panel / own -500/10 tint. */
const TEXT_ACCENTS: AccentRow[] = [
    { cls: 'text-emerald-400', dark: '#34d399', light: '#047857', note: 'emerald-700 = success · 5.5 / 5.0 / 4.6 · :695' },
    { cls: 'text-emerald-300', dark: '#6ee7b7', light: '#047857', note: 'emerald-700 = success · :696' },
    { cls: 'text-emerald-500', dark: '#10b981', light: '#065f46', note: 'emerald-800 · 7.7 / 7.0 / 6.4 · :697' },
    { cls: 'text-red-400', dark: '#f87171', light: '#b91c1c', note: 'red-700 = danger · 6.5 / 5.9 / 5.2 · :688' },
    { cls: 'text-red-300', dark: '#fca5a5', light: '#b91c1c', note: 'red-700 = danger · :687' },
    { cls: 'text-amber-400', dark: '#fbbf24', light: '#92400e', note: 'amber-800 = warning · 7.1 / 6.5 / 6.0 · :690' },
    { cls: 'text-amber-300', dark: '#fcd34d', light: '#92400e', note: 'amber-800 = warning · :689' },
    { cls: 'text-yellow-400', dark: '#facc15', light: '#854d0e', note: 'yellow-800 · 6.9 / 6.3 / 5.9 · :691' },
    { cls: 'text-green-400', dark: '#4ade80', light: '#166534', note: 'green-800 · 7.1 / 6.5 / 6.0 · :693' },
    { cls: 'text-purple-400', dark: '#c084fc', light: '#7c3aed', note: 'violet-600 · 5.7 / 5.2 / 4.6 · :698' },
    { cls: 'text-indigo-400', dark: '#818cf8', light: '#4f46e5', note: 'indigo-600 · 6.3 / 5.7 / 5.1 · :700' },
    { cls: 'text-indigo-300', dark: '#a5b4fc', light: '#4f46e5', note: 'indigo-600 · :699' },
    { cls: 'text-cyan-400', dark: '#22d3ee', light: '#155e75', note: 'cyan-800 · 7.3 / 6.6 / 6.1 · :702' },
    { cls: 'text-blue-400', dark: '#60a5fa', light: '#1d4ed8', note: 'blue-700 · 6.7 / 6.1 / 5.5 · :704' },
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

/** Tinted surfaces: `-500/10` fill + `-500/30` border, remapped at `:723-758` / `:759-773`. */
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

/** Solid fills: same fill in both families; `:795-801` forces white label text on light. */
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
            blurb="One class, two paintings. Semantic accents are raw Tailwind hues; the light family repaints them in index.css. Every repaint clears WCAG AA on the light surface, the panel and its own tinted chip; new code should still prefer text-success / text-warning / text-danger."
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
