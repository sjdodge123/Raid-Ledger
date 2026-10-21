/**
 * ROK-1880 — render-side cleanup of a stored pin label. The mod sends the
 * raw `Minimap.PinData.m_name`, which can carry Unity rich-text tags and
 * unlocalised `$tokens` (`$hud_mapday 12`, `$enemy_eikthyr`). Pure: no React.
 */

const RICH_TEXT_TAG = /<\/?[a-z]+(?:=[^>]*)?>/gi;
const MAP_DAY = /^\$hud_mapday\s+(\d+)$/i;
const NAMED_TOKEN = /^\$(?:enemy|location|piece)_([a-z0-9_]+)$/i;
const ANY_TOKEN = /^\$\S+/;

/** `hildir_cave` → `Hildir Cave`. */
function titleCase(snake: string): string {
    return snake
        .split('_')
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

/**
 * The readable text for a pin label: rich-text tags stripped, known tokens
 * mapped (`$hud_mapday N` → "Day N", `$enemy_/$location_/$piece_<name>` →
 * the title-cased name), any other `$token` or a blank → `typeLabel`.
 */
export function cleanPinLabel(label: string, typeLabel: string): string {
    const text = label.replace(RICH_TEXT_TAG, '').trim();
    if (text.length === 0) return typeLabel;
    const day = MAP_DAY.exec(text);
    if (day) return `Day ${day[1] ?? ''}`.trim();
    const named = NAMED_TOKEN.exec(text);
    if (named) return titleCase(named[1] ?? '') || typeLabel;
    return ANY_TOKEN.test(text) ? typeLabel : text;
}
