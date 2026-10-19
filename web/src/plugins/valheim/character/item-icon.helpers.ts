/**
 * ROK-1836 — the item fallback ladder (D7), the atlas sprite geometry (D6) and
 * the wiki link-out (D11). Pure: no React, never throws on any catalogue shape.
 */
import type {
    ValheimCatalogEntry, ValheimCatalogIcon, ValheimItemStack, ValheimMapBaseMap,
} from '@raid-ledger/contract';

export type ValheimItemCatalogue = Partial<Record<string, ValheimCatalogEntry>>;

/** `icon` = draw the catalogue icon; `initials` = name tile; `unknown` = prefab id tile. */
export type ResolvedItemKind = 'icon' | 'initials' | 'unknown';

export interface ResolvedItem {
    label: string;
    category: string | null;
    kind: ResolvedItemKind;
    icon: ValheimCatalogIcon | null;
}

/** Can this icon be drawn? A file always can; an atlas sprite needs a ready atlas. */
function iconDrawable(icon: ValheimCatalogIcon | null, atlas: ValheimMapBaseMap | null): icon is ValheimCatalogIcon {
    if (icon === null) return false;
    return icon.kind === 'file' || (atlas !== null && atlas.ready);
}

/** D7: catalogue name + icon → name + initials tile → prefab id on a neutral tile. */
export function resolveItem(
    prefab: string, items: ValheimItemCatalogue | undefined, atlas: ValheimMapBaseMap | null | undefined,
): ResolvedItem {
    const entry = items?.[prefab];
    if (entry === undefined) return { label: prefab, category: null, kind: 'unknown', icon: null };
    const drawable = iconDrawable(entry.icon, atlas ?? null);
    return {
        label: entry.name,
        category: entry.category === '' ? null : entry.category,
        kind: drawable ? 'icon' : 'initials',
        icon: drawable ? entry.icon : null,
    };
}

/** Up to two initials from a display name: "Iron sword" → "IS". */
export function itemInitials(label: string): string {
    const words = label.split(/[\s_-]+/).filter((w) => w.length > 0);
    return words.slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();
}

export interface SpriteGeometry {
    backgroundPosition: string;
    backgroundSize: string;
    width: number;
    height: number;
}

/** D6: scale one atlas cell to fit `box` px (longest edge), keeping its aspect. */
export function spriteGeometry(
    icon: { x: number; y: number; w: number; h: number }, atlas: { width: number; height: number }, box: number,
): SpriteGeometry {
    const scale = box / Math.max(icon.w, icon.h);
    const px = (n: number): string => `${Math.round(n * scale * 100) / 100}px`;
    return {
        backgroundPosition: `-${px(icon.x)} -${px(icon.y)}`,
        backgroundSize: `${px(atlas.width)} ${px(atlas.height)}`,
        width: Math.round(icon.w * scale),
        height: Math.round(icon.h * scale),
    };
}

/** D11: the official wiki page for a catalogue name — spaces become `_`, then URL-encoded. */
export function valheimWikiUrl(name: string): string {
    return `https://valheim.weirdgloop.org/w/${encodeURIComponent(name.trim().replace(/\s+/g, '_'))}`;
}

/** Durability as 0–100, or null when the item has none (or a zero max). */
export function durabilityPct(item: ValheimItemStack): number | null {
    if (item.durability === null || item.maxDurability === null || item.maxDurability <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((item.durability / item.maxDurability) * 100)));
}

/** The tile's accessible name: "Iron sword, 3, quality 2, equipped". */
export function itemAriaLabel(label: string, item: ValheimItemStack, equipped: boolean): string {
    const parts = [label];
    if (item.stack > 1) parts.push(String(item.stack));
    if (item.quality > 1) parts.push(`quality ${item.quality}`);
    if (equipped) parts.push('equipped');
    return parts.join(', ');
}
