/**
 * ROK-2136 — pure helpers for the guild in-game text card and editor: labels,
 * warning copy, the draft model, the PUT body and the 409 body parser.
 * Imported only by the lazy card body and dialog (it carries a runtime schema).
 */
import {
    GuildIngameTextSchema,
    hasIngameControlChars,
    type GuildIngameText,
    type GuildIngameTextField,
    type IngameTextFieldKey,
    type IngameTextWarning,
    type PutGuildIngameText,
} from '@raid-ledger/contract';
import { errorBodyOf, isConflictError } from '../../../lib/api/api-error';
import { syncedAgo } from '../../../lib/synced-ago';

/** Blizzard's own words for the two in-game boxes (OQ-2). */
export const FIELD_LABELS: Record<IngameTextFieldKey, string> = {
    motd: 'Message of the Day',
    info: 'Guild Information',
};

/** One `text-warning` line per warning — warned, never blocked (OQ-4/OQ-5/OQ-11). */
export const WARNING_COPY: Record<IngameTextWarning, string> = {
    pipe: '| is WoW’s colour-code character — it may not paste as typed.',
    astral: 'Emoji and some symbols don’t show in game.',
    'newline-in-motd': 'Line breaks may show as one line in chat.',
};

export const CONTROL_CHAR_COPY = 'Remove tabs and other invisible characters — the game box can’t take them.';

/** ROK-2137 — the editor-only "Changed in game" notice copy. */
export const GAME_NOTICE_COPY = {
    heading: 'Changed in game',
    empty: 'The in-game box is empty.',
    adopt: 'Use in-game text',
    keep: 'Keep hub text',
    keptHint: 'Hub text kept — use Copy for in-game to put it back in the game.',
    showAll: 'Show all',
    showLess: 'Show less',
    adoptError: 'Could not use the in-game text',
    keepError: 'Could not keep the hub text',
} as const;

export const FIELD_KEYS: readonly IngameTextFieldKey[] = ['motd', 'info'];

export interface GuildTextDraft { motd: string; info: string }

/** What a draft started from: the two stored fields (null = not set). */
export type GuildTextBase = Pick<GuildIngameText, 'motd' | 'info'>;

export function draftOf(base: GuildTextBase): GuildTextDraft {
    return { motd: base.motd?.text ?? '', info: base.info?.text ?? '' };
}

export function isDirty(draft: GuildTextDraft, base: GuildTextBase): boolean {
    const start = draftOf(base);
    return draft.motd !== start.motd || draft.info !== start.info;
}

/**
 * Only the fields the editor changed, each with its loaded `updatedAt` sent
 * back verbatim (null when the field was unset). An untouched field is
 * omitted, so the server never conflict-checks it (D6, per field): editing
 * only Info never 409s because someone else changed the MOTD.
 */
export function toPutBody(draft: GuildTextDraft, base: GuildTextBase): PutGuildIngameText {
    const start = draftOf(base);
    const body: PutGuildIngameText = {};
    if (draft.motd !== start.motd) {
        body.motd = draft.motd;
        body.baseMotdUpdatedAt = base.motd?.updatedAt ?? null;
    }
    if (draft.info !== start.info) {
        body.info = draft.info;
        body.baseInfoUpdatedAt = base.info?.updatedAt ?? null;
    }
    return body;
}

/** The first field holding a character the server rejects (400), or null. */
export function draftError(draft: GuildTextDraft): IngameTextFieldKey | null {
    return FIELD_KEYS.find((key) => hasIngameControlChars(draft[key])) ?? null;
}

/** A stamp that moves whenever either stored field changes — the clean-draft rebase trigger. */
export function baseStamp(base: GuildTextBase): string {
    return `${base.motd?.updatedAt ?? ''}|${base.info?.updatedAt ?? ''}`;
}

/** "Updated 3 h ago by Mira" — "a former member" once the editor's account is gone. */
export function updatedLine(field: GuildIngameTextField, now: number = Date.now()): string {
    return `Updated ${syncedAgo(field.updatedAt, now)} by ${field.updatedBy ?? 'a former member'}`;
}

/** The current text a 409 carried (`{ message, ingameText }`), or null when the error is not a parseable conflict. */
export function conflictTextOf(error: unknown): GuildIngameText | null {
    if (!isConflictError(error)) return null;
    const parsed = GuildIngameTextSchema.safeParse(errorBodyOf(error)?.['ingameText']);
    return parsed.success ? parsed.data : null;
}
