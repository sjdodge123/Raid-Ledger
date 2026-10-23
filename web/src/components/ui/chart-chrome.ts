import type { CSSProperties } from 'react';

/**
 * Shared recharts chrome (ROK-1937) — the tooltip, cursor, axis and grid
 * styling every chart uses, built ONLY on the theme's CSS variables so the
 * fifteen schemes (dark and light families) remap it. Series colours stay
 * with the chart (categorical, design-system.md §2.2); everything around
 * the data comes from here. Never hardcode a hex in chart chrome.
 *
 * recharts 3 paints a tooltip value line `entry.color || '#000'`, and a
 * `<Bar>` coloured through `<Cell>`s has no `entry.color` — so
 * `chartTooltipItemStyle` sets an explicit token colour, never the fallback.
 */

/** Tooltip box: panel fill, edge border, foreground text. */
export const chartTooltipContentStyle: CSSProperties = {
    backgroundColor: 'var(--color-panel)',
    border: '1px solid var(--color-edge)',
    borderRadius: '8px',
    color: 'var(--color-foreground)',
};

/** Tooltip title (the hovered category / date). */
export const chartTooltipLabelStyle: CSSProperties = {
    color: 'var(--color-foreground)',
    fontWeight: 600,
};

/** Tooltip value lines — explicit token colour so recharts never falls back to `#000`. */
export const chartTooltipItemStyle: CSSProperties = {
    color: 'var(--color-foreground)',
};

/** Hover band behind the active bar group (bar charts). */
export const chartBarCursor = {
    fill: 'var(--color-overlay)',
    fillOpacity: 0.4,
} as const;

/** Hover rule through the active point (line charts). */
export const chartLineCursor = {
    stroke: 'var(--color-edge-strong)',
} as const;

/** Spread onto `<Tooltip>` for a bar chart: `<Tooltip {...chartBarTooltipProps} />`. */
export const chartBarTooltipProps = {
    contentStyle: chartTooltipContentStyle,
    labelStyle: chartTooltipLabelStyle,
    itemStyle: chartTooltipItemStyle,
    cursor: chartBarCursor,
} as const;

/** Spread onto `<Tooltip>` for a line chart: `<Tooltip {...chartLineTooltipProps} />`. */
export const chartLineTooltipProps = {
    contentStyle: chartTooltipContentStyle,
    labelStyle: chartTooltipLabelStyle,
    itemStyle: chartTooltipItemStyle,
    cursor: chartLineCursor,
} as const;

/** Spread onto `<XAxis>` / `<YAxis>`: muted axis line and tick labels. */
export const chartAxisProps = {
    stroke: 'var(--color-muted)',
    tick: { fill: 'var(--color-muted)' },
} as const;

/** Spread onto `<CartesianGrid>`: dashed edge-coloured grid lines. */
export const chartGridProps = {
    stroke: 'var(--color-edge)',
    strokeDasharray: '3 3',
} as const;

/** Spread onto `<PolarGrid>` (radar charts). */
export const chartPolarGridProps = {
    stroke: 'var(--color-edge)',
} as const;

/** `tick` for `<PolarAngleAxis>` (radar charts); pass a `fontSize` alongside. */
export const chartPolarTick = {
    fill: 'var(--color-muted)',
} as const;
