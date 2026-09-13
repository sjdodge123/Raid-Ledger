/**
 * Token swatches for /dev/design-system (ROK-1539).
 *
 * Each row shows the token rendered LIVE in the viewer's current theme next to
 * the documented dark-default and light-family hex values, so a theme author
 * can see at a glance whether the active theme has drifted from either.
 * Hexes are transcribed from `web/src/index.css` (@theme block + the
 * :is([data-scheme="light"],...) override) — keep them in step with that file.
 */
import type { JSX } from 'react';
import { Section } from './design-system-bits';

interface TokenRow {
    token: string;
    cls: string;
    dark: string;
    light: string;
    role: string;
}

const SURFACE_TOKENS: TokenRow[] = [
    { token: '--color-backdrop', cls: 'bg-backdrop', dark: '#020617', light: '#f8fafc', role: 'Page background' },
    { token: '--color-surface', cls: 'bg-surface', dark: '#0f172a', light: '#ffffff', role: 'Cards, headers, sheets' },
    { token: '--color-panel', cls: 'bg-panel', dark: '#1e293b', light: '#f1f5f9', role: 'Inset panels, inputs, chips (off)' },
    { token: '--color-overlay', cls: 'bg-overlay', dark: '#334155', light: '#e2e8f0', role: 'Hover fill' },
];

const TEXT_TOKENS: TokenRow[] = [
    { token: '--color-faint', cls: 'text-faint', dark: '#475569', light: '#cbd5e1', role: 'Lowest-contrast text' },
    { token: '--color-dim', cls: 'text-dim', dark: '#64748b', light: '#64748b', role: 'Placeholders, disabled' },
    { token: '--color-muted', cls: 'text-muted', dark: '#94a3b8', light: '#475569', role: 'Secondary / label text' },
    { token: '--color-secondary', cls: 'text-secondary', dark: '#cbd5e1', light: '#334155', role: 'Body text' },
    { token: '--color-foreground', cls: 'text-foreground', dark: '#ffffff', light: '#0f172a', role: 'Primary text, headings' },
];

const EDGE_TOKENS: TokenRow[] = [
    { token: '--color-edge', cls: 'border-edge', dark: '#334155', light: '#cbd5e1', role: 'Default border' },
    { token: '--color-edge-strong', cls: 'border-edge-strong', dark: '#475569', light: '#94a3b8', role: 'Emphasised border' },
    { token: '--color-edge-subtle', cls: 'border-edge-subtle', dark: '#1e293b', light: '#e2e8f0', role: 'Hairline divider' },
];

/** Live chip (current theme) + the documented dark and light values. */
function SwatchTrio({ row }: { row: TokenRow }): JSX.Element {
    const liveCls = row.cls.startsWith('bg-')
        ? `${row.cls} border border-edge`
        : row.cls.startsWith('border-')
            ? `bg-panel border-4 ${row.cls}`
            : `bg-panel border border-edge ${row.cls}`;
    return (
        <div className="flex items-center gap-1.5">
            <span data-testid={`swatch-live-${row.token}`} className={`w-8 h-8 rounded-md ${liveCls} flex items-center justify-center text-[10px] font-bold`}>
                {row.cls.startsWith('text-') ? 'Aa' : ''}
            </span>
            <span className="w-8 h-8 rounded-md border border-edge" style={{ backgroundColor: row.dark }} title={`dark ${row.dark}`} />
            <span className="w-8 h-8 rounded-md border border-edge" style={{ backgroundColor: row.light }} title={`light ${row.light}`} />
        </div>
    );
}

function TokenTable({ caption, rows }: { caption: string; rows: TokenRow[] }): JSX.Element {
    return (
        <div className="mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">{caption}</h3>
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.token} className="flex items-center gap-4 text-xs">
                        <SwatchTrio row={row} />
                        <code className="text-secondary w-48 shrink-0">{row.token}</code>
                        <code className="text-emerald-300 w-40 shrink-0">{row.cls}</code>
                        <span className="text-muted">{row.role}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

const ACCENTS = [
    { hue: 'emerald', cls: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', means: 'Primary action, success, "on"' },
    { hue: 'amber', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-300', means: 'Warning, admin, chip-on' },
    { hue: 'red', cls: 'bg-red-500/10 border-red-500/30 text-red-300', means: 'Danger, destructive' },
    { hue: 'indigo', cls: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300', means: 'Secondary CTA, info' },
];

function AccentRow(): JSX.Element {
    return (
        <div className="mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">Semantic accents (raw Tailwind hues, by convention)</h3>
            <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                    <span key={a.hue} className={`px-3 py-1.5 rounded-full border text-xs font-medium ${a.cls}`}>
                        {a.hue} — {a.means}
                    </span>
                ))}
            </div>
            <p className="text-[10px] text-dim mt-2">
                Alpha-on-token is the house style for tinted surfaces; solid fills (bg-emerald-600) are for buttons only.
            </p>
        </div>
    );
}

const TYPE_ROWS = [
    { cls: 'text-3xl font-bold', label: 'text-3xl font-bold — page <h1> (pages/ only)' },
    { cls: 'text-xl font-semibold', label: 'text-xl font-semibold — sub-page / dev-page title' },
    { cls: 'text-lg font-semibold', label: 'text-lg font-semibold — section heading' },
    { cls: 'text-base', label: 'text-base — mobile form inputs only (stops iOS zoom)' },
    { cls: 'text-sm', label: 'text-sm — the default: body, labels, buttons, rows' },
    { cls: 'text-xs', label: 'text-xs — hints, metadata, badges, captions' },
];

function TypeScale(): JSX.Element {
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Type scale</h3>
            <div className="space-y-1">
                {TYPE_ROWS.map((t) => (
                    <p key={t.cls} className={`${t.cls} text-foreground`}>{t.label}</p>
                ))}
                <p className="text-sm text-foreground font-display mt-2">font-display (Cinzel) — brand and hero moments only</p>
            </div>
        </div>
    );
}

/** Token swatches: surfaces, text, borders, accents, type scale. */
export function TokensSection(): JSX.Element {
    return (
        <Section
            id="tokens"
            title="Tokens"
            blurb="Left swatch = live in your current theme. Middle = documented dark default. Right = light family. If the live chip does not match one of the two, the active theme has drifted."
        >
            <TokenTable caption="Surfaces" rows={SURFACE_TOKENS} />
            <TokenTable caption="Text" rows={TEXT_TOKENS} />
            <TokenTable caption="Borders" rows={EDGE_TOKENS} />
            <AccentRow />
            <TypeScale />
        </Section>
    );
}
