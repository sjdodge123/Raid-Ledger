/**
 * ROK-1786 — client-side PREVIEW of a pasted addon link (name + source). It
 * runs the contract's `parseAddonLink`, the same function the server stores
 * with, so the preview and the server's 400 agree on every input.
 */
import { parseAddonLink, type GuildAddonSource } from '@raid-ledger/contract';

export interface ParsedAddonUrl { name: string; source: GuildAddonSource }

export type AddonUrlPreview = { ok: true; addon: ParsedAddonUrl } | { ok: false; error: string };

/** The preview, or the server's own rejection message. */
export function previewAddonUrl(raw: string): AddonUrlPreview {
    const result = parseAddonLink(raw);
    return result.ok
        ? { ok: true, addon: { name: result.link.suggestedName, source: result.link.source } }
        : { ok: false, error: result.error };
}

/** `null` for anything the server would reject. */
export function parseAddonUrl(raw: string): ParsedAddonUrl | null {
    const preview = previewAddonUrl(raw);
    return preview.ok ? preview.addon : null;
}
