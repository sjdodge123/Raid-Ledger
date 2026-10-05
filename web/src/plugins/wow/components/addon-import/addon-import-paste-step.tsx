/**
 * Paste step of the addon "Import string" dialog (ROK-1724 §4.4).
 *
 * - `Field` + mono `Textarea`. Under it, a client-side header chip read with
 *   the contract's `ADDON_IMPORT_PAGE_RE` ("Character · RL1" /
 *   "Guild · page 2 of 3") and a size line ("12.4 KB of 256 KB").
 * - Over `ADDON_IMPORT_MAX_BYTES` is an inline `Field` error at once, and the
 *   string is never sent: `sendableImportString` returns null for it.
 * - A paste checks the string (`onCheck`, the dialog's `dryRun: true` call);
 *   the footer's "Check string" is `AddonImportPasteActions`.
 */
import { useRef, type ChangeEvent, type JSX } from 'react';
import { ADDON_IMPORT_MAX_BYTES, ADDON_IMPORT_PAGE_RE } from '@raid-ledger/contract';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Button } from '../../../../components/ui/button';
import { AddonImportErrorBanner } from './addon-import-error-banner';

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

function sizeError(bytes: number): string | undefined {
    if (bytes <= ADDON_IMPORT_MAX_BYTES) return undefined;
    return `This string is ${formatKb(bytes)}, over the ${formatKb(ADDON_IMPORT_MAX_BYTES)} limit. Export one section at a time.`;
}

export interface AddonImportPasteStepProps {
    value: string;
    onChange: (value: string) => void;
    /** Called with the trimmed string on paste, only when it is sendable. */
    onCheck: (importString: string) => void;
    /** The last preview error, shown as a danger banner. */
    error?: unknown;
    /** The open character's game id, for the name-mismatch Add Character link. */
    gameId?: number | undefined;
}

function useCheckOnPaste(onChange: (v: string) => void, onCheck: (s: string) => void) {
    const pasted = useRef(false);
    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
        const next = e.target.value;
        onChange(next);
        if (!pasted.current) return;
        pasted.current = false;
        const sendable = sendableImportString(next);
        if (sendable) onCheck(sendable);
    };
    return { onPaste: () => { pasted.current = true; }, onChange: handleChange };
}

function PasteMeta({ value }: { value: string }): JSX.Element {
    const header = importStringHeaderLabel(value);
    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            {header && (
                <span data-testid="addon-import-header" className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-panel border border-edge text-xs font-medium text-secondary">
                    {header}
                </span>
            )}
            <span data-testid="addon-import-size" className="text-xs text-muted">
                {formatKb(importStringBytes(value))} of {formatKb(ADDON_IMPORT_MAX_BYTES)}
            </span>
        </div>
    );
}

export function AddonImportPasteStep(props: AddonImportPasteStepProps): JSX.Element {
    const handlers = useCheckOnPaste(props.onChange, props.onCheck);
    return (
        <div className="space-y-3">
            <Field
                label="Export string"
                hint="In game: /rl export char, guild or raid, then Ctrl+C."
                error={sizeError(importStringBytes(props.value))}
            >
                <Textarea
                    value={props.value}
                    {...handlers}
                    rows={6}
                    resize="none"
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono text-xs break-all"
                />
            </Field>
            <PasteMeta value={props.value} />
            {props.error != null && <AddonImportErrorBanner error={props.error} gameId={props.gameId} />}
        </div>
    );
}

export interface AddonImportPasteActionsProps {
    value: string;
    onCheck: (importString: string) => void;
    onCancel: () => void;
    checking: boolean;
}

/** Footer for the paste step: Cancel + "Check string" (disabled while not sendable). */
export function AddonImportPasteActions(props: AddonImportPasteActionsProps): JSX.Element {
    const sendable = sendableImportString(props.value);
    return (
        <>
            <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
            <Button
                disabled={!sendable}
                loading={props.checking}
                loadingLabel="Checking…"
                onClick={() => { if (sendable) props.onCheck(sendable); }}
            >
                Check string
            </Button>
        </>
    );
}
