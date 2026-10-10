/**
 * ROK-1203 contrast-audit record building: the scheme x viewport matrix, the
 * axe scan (reusing axe-contrast.ts's `contrastData`), the in-page token and
 * component lookup, and the JSONL writer contrast-audit.aggregate.mjs reads.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { contrastData } from './axe-contrast';

/** Also the audit config's outputDir, so Playwright empties it at the start of every run. */
export const AUDIT_DIR = path.resolve('test-results/contrast-audit');

export interface AuditScheme {
    id: string;
    mode: 'light' | 'dark';
    /** What `<html data-scheme>` must read before a scan (web/src/stores/theme-helpers.ts). */
    dataScheme: string;
}

export const SCHEMES: readonly AuditScheme[] = [
    { id: 'default-dark', mode: 'dark', dataScheme: 'dark' },
    { id: 'default-light', mode: 'light', dataScheme: 'light' },
    { id: 'celestial', mode: 'light', dataScheme: 'celestial' },
];

export interface AuditViewport {
    name: 'desktop' | 'phone';
    width: number;
    height: number;
}

export const VIEWPORTS: readonly AuditViewport[] = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 375, height: 812 },
];

export type AuditStatus = 'ok' | 'redirect' | 'skipped' | 'timeout' | 'error';

export interface AuditViolation {
    selector: string;
    fg: string | null;
    bg: string | null;
    ratio: number | null;
    required: number | null;
    text: string;
    tokenHint: string;
    component: string | null;
}

export interface AuditRecord {
    route: string;
    scheme: string;
    viewport: string;
    status: AuditStatus;
    url?: string;
    finalUrl?: string;
    reason?: string;
    violations: AuditViolation[];
    /** axe `incomplete` nodes (gradients, images): it could not decide. */
    needsReview: AuditViolation[];
}

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeNode = AxeResults['violations'][number]['nodes'][number];

interface PageInspection {
    /** `#rrggbb` -> the `--color-*` tokens that compute to it. */
    tokens: Record<string, string[]>;
    nodes: { text: string; component: string | null }[];
}

/** Append one record to `<scheme>-<viewport>.jsonl`. */
export function appendRecord(record: AuditRecord): void {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(path.join(AUDIT_DIR, `${record.scheme}-${record.viewport}.jsonl`), `${JSON.stringify(record)}\n`);
}

/**
 * Runs INSIDE the page (self-contained): resolve every `--color-*` token
 * declared in same-origin stylesheets to `#rrggbb` through a 1x1 canvas (any
 * CSS colour syntax), and give each axe target its text and nearest testid.
 */
export function inspectPage(targets: string[]): PageInspection {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const toHex = (raw: string): string | null => {
        if (!ctx || raw === '') return null;
        const css = /^[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?$/.test(raw) ? `rgb(${raw})` : raw;
        ctx.fillStyle = '#010203';
        ctx.fillStyle = css;
        if (ctx.fillStyle === '#010203') return null;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        return `#${[...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    };
    const names = new Set<string>();
    for (const sheet of [...document.styleSheets]) {
        try {
            for (const m of [...sheet.cssRules].map((r) => r.cssText).join('\n').matchAll(/(--color-[\w-]+)\s*:/g)) names.add(m[1] ?? '');
        } catch { /* cross-origin sheet: unreadable, skip */ }
    }
    const root = getComputedStyle(document.documentElement);
    const tokens: Record<string, string[]> = {};
    for (const name of [...names].filter(Boolean).sort()) {
        const hex = toHex(root.getPropertyValue(name).trim());
        if (hex) tokens[hex] = [...(tokens[hex] ?? []), name];
    }
    const nodes = targets.map((target) => {
        let el: Element | null = null;
        try { el = document.querySelector(target); } catch { el = null; }
        const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return { text, component: el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null };
    });
    return { tokens, nodes };
}

/** `--color-x on --color-y`; a colour no token computes to is `raw(#hex)`. */
export function tokenHint(fg: string | null, bg: string | null, tokens: Record<string, string[]>): string {
    const name = (hex: string | null): string =>
        hex === null ? 'unknown' : tokens[hex.toLowerCase()]?.slice(0, 2).join('|') ?? `raw(${hex})`;
    return `${name(fg)} on ${name(bg)}`;
}

function toViolation(node: AxeNode, detail: PageInspection['nodes'][number] | undefined, tokens: PageInspection['tokens']): AuditViolation {
    const d = contrastData(node);
    const fg = d.fgColor ?? null;
    const bg = d.bgColor ?? null;
    const required = Number.parseFloat(d.expectedContrastRatio ?? '');
    return {
        selector: node.target.map(String).join(' >> '),
        fg, bg,
        ratio: d.contrastRatio ?? null,
        required: Number.isFinite(required) ? required : null,
        text: detail?.text ?? '',
        tokenHint: tokenHint(fg, bg, tokens),
        component: detail?.component ?? null,
    };
}

/** axe `color-contrast` on the WHOLE page (no include/exclude), as audit rows. */
export async function scanContrast(page: Page): Promise<Pick<AuditRecord, 'violations' | 'needsReview'>> {
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const failed = results.violations.flatMap((v) => v.nodes);
    const unsure = results.incomplete.flatMap((v) => v.nodes);
    const all = [...failed, ...unsure];
    const inspection = await page.evaluate(inspectPage, all.map((n) => n.target.map(String).join(' >> ')));
    const rows = all.map((n, i) => toViolation(n, inspection.nodes[i], inspection.tokens));
    return { violations: rows.slice(0, failed.length), needsReview: rows.slice(failed.length) };
}
