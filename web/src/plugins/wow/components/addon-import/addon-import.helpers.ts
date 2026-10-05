/**
 * Pure helpers for the addon "Import string" dialog (ROK-1724 §4.4): size and
 * header parsing of the paste, the Import gate, and summary/headline copy.
 * Kept out of the component files so they stay fast-refresh clean.
 */
import {
    ADDON_IMPORT_MAX_BYTES,
    ADDON_IMPORT_PAGE_RE,
    type AddonImportResultDto,
    type AddonImportWarning,
} from '@raid-ledger/contract';
import type { AddonImportConfirm } from './use-addon-import';

const SECTION_LABELS: Record<string, string> = { char: 'Character', guild: 'Guild', raid: 'Raid' };

export function importStringBytes(text: string): number {
    return new TextEncoder().encode(text.trim()).length;
}

export function formatKb(bytes: number): string {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
}

/** The trimmed string when it may be sent; null when empty or over the cap. */
export function sendableImportString(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed || importStringBytes(trimmed) > ADDON_IMPORT_MAX_BYTES) return null;
    return trimmed;
}

/** Chip label from the page header(s); null when the text is not a recognisable import string. */
export function importStringHeaderLabel(text: string): string | null {
    const pages = text.trim().split(/\s+/).filter(Boolean);
    const first = pages.length ? ADDON_IMPORT_PAGE_RE.exec(pages[0] ?? '') : null;
    if (!first) return null;
    const [, version, section = '', page, of] = first;
    const label = SECTION_LABELS[section] ?? section;
    if (!page || !of) return `${label} · RL${version}`;
    if (pages.length > 1) return `${label} · ${pages.length} of ${of} pages`;
    return `${label} · page ${page} of ${of}`;
}

function hasWarning(result: AddonImportResultDto, code: AddonImportWarning['code']): boolean {
    return result.warnings.some((w) => w.code === code);
}

/** Import is allowed only for a fresh preview whose required confirmations are ticked. */
export function canApplyAddonImport(result: AddonImportResultDto, confirm: AddonImportConfirm): boolean {
    if (result.status !== 'preview') return false;
    return !hasWarning(result, 'GUID_CHANGED') || confirm.repinGuid === true;
}

type Row = readonly [label: string, value: string];

function charRows(s: Extract<AddonImportResultDto, { section: 'char' }>['summary']): Row[] {
    const ilvl = s.avgIlvl === null ? '' : ` · avg ilvl ${Math.round(s.avgIlvl)}`;
    return [
        ['Gear', `${s.gearCount} items${ilvl}`],
        ['Talents', `${s.talentNodes} nodes`],
        ['Lockouts', String(s.lockouts)],
    ];
}

function guildRows(s: Extract<AddonImportResultDto, { section: 'guild' }>['summary']): Row[] {
    return [
        ['Guild', s.guildName],
        ['Members', `${s.members} (${s.newMembers} new, ${s.updatedMembers} updated)`],
        ['Pages', String(s.pages)],
    ];
}

function raidRows(s: Extract<AddonImportResultDto, { section: 'raid' }>['summary']): Row[] {
    return [
        ['Pulls', `${s.pulls} (${s.newPulls} new, ${s.duplicatePulls} already imported)`],
        ['Kills / wipes', `${s.kills} / ${s.wipes}`],
    ];
}

export function summaryRows(result: AddonImportResultDto): Row[] {
    if (result.section === 'char') return charRows(result.summary);
    if (result.section === 'guild') return guildRows(result.summary);
    return raidRows(result.summary);
}

export function diffRows(result: AddonImportResultDto): Row[] {
    const rows: Row[] = [];
    const { class: cls, level } = result.diff;
    if (cls) rows.push(['Class', `${cls.from ?? '—'} → ${cls.to}`]);
    if (level) rows.push(['Level', `${level.from ?? '—'} → ${level.to}`]);
    return rows;
}

/** "via addon · self-reported · 4 Oct 2026" from the payload's `exportedAt` (unix seconds). */
export function provenanceLine(exportedAt: number): string {
    const date = new Date(exportedAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `via addon · self-reported · ${date}`;
}

const SECTION_NOUN: Record<AddonImportResultDto['section'], string> = {
    char: 'Character data',
    guild: 'Guild roster',
    raid: 'Boss pulls',
};

export function resultHeadline(result: AddonImportResultDto): string {
    const noun = SECTION_NOUN[result.section];
    if (result.status === 'noop') return `${noun} already up to date — nothing changed.`;
    if (result.status === 'stale') return `${noun} not imported — a newer export is already saved.`;
    return `${noun} imported.`;
}

