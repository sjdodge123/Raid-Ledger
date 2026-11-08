/**
 * Pure helpers for the addon "Import string" dialog (ROK-1724 §4.4): size and
 * header parsing of the paste, the Import gate, and summary/headline copy.
 * Kept out of the component files so they stay fast-refresh clean.
 */
import {
    ADDON_IMPORT_MAX_BYTES,
    ADDON_IMPORT_PAGE_RE,
    WOW_FOREVER_RULESET_LABELS,
    WOW_FOREVER_SELECTABLE_RULESETS,
    type AddonImportResultDto,
    type AddonImportRulesetInferenceDto,
    type WowForeverSelectableRuleset,
    type AddonImportWarning,
    type AddonMailworthyImportOutcome,
    type AddonMailworthyImportSkipReason,
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

const MAILWORTHY_SKIP_COPY: Record<AddonMailworthyImportSkipReason, string> = {
    guild_unresolved: 'guild not found — import the guild roster first',
    not_on_roster: "you're not on the latest guild roster",
    givers_rejected: 'no givers are on the latest guild roster',
};

/** ROK-2148 Q8: what the import did with the Mailworthy block (applied char sections only). */
export function mailworthyRow(outcome: AddonMailworthyImportOutcome | undefined): Row | null {
    if (!outcome) return null;
    if (outcome.status === 'skipped') return ['Guild contributions', `Skipped — ${MAILWORTHY_SKIP_COPY[outcome.reason]}`];
    const plural = outcome.givers === 1 ? '' : 's';
    const rejected = outcome.giversRejected > 0 ? ` · ${outcome.giversRejected} not on the roster` : '';
    return ['Guild contributions', `Updated ${outcome.givers} giver${plural}${rejected}`];
}

function charRows(s: Extract<AddonImportResultDto, { section: 'char' }>['summary']): Row[] {
    const ilvl = s.avgIlvl === null ? '' : ` · avg ilvl ${Math.round(s.avgIlvl)}`;
    const mailworthy = mailworthyRow(s.mailworthy);
    return [
        ['Gear', `${s.gearCount} items${ilvl}`],
        ['Talents', `${s.talentNodes} nodes`],
        ['Lockouts', String(s.lockouts)],
        ...(mailworthy ? [mailworthy] : []),
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


/**
 * ROK-1739 D5/D6: the realm-inferred ruleset when the create picker can use it.
 * Hardcore is never selectable (A1), so a Hardcore inference returns null.
 */
export function selectableInference(inference: AddonImportRulesetInferenceDto | undefined): WowForeverSelectableRuleset | null {
    if (!inference) return null;
    return WOW_FOREVER_SELECTABLE_RULESETS.find((v) => v === inference.ruleset) ?? null;
}

/** ROK-1739 §6.3: the picker hint naming the realm the inference came from. */
export function rulesetPickerHint(inference: AddonImportRulesetInferenceDto | undefined): string | undefined {
    if (!inference) return undefined;
    if (selectableInference(inference)) return `Pre-selected from realm ${inference.realmName} — change it if that's wrong.`;
    const label = WOW_FOREVER_RULESET_LABELS[inference.ruleset];
    return `Realm ${inference.realmName} is listed as ${label}, which can't be added yet — pick a ruleset.`;
}
