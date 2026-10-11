/**
 * ROK-1760: the display name + quality a raw WoW item link already carries
 * (`|cnIQ1:|Hitem:6120::…|h[Recruit's Shirt]|h|r`), kept on the stored gear
 * entry as a plain-text fallback until Wowhead resolves the item. Must run on
 * the RAW link — `stripEscapes` removes the `|h` markers this reads.
 */

/** Longest stored fallback name (UTF-16 code units, matching the Zod max). */
export const LINK_NAME_MAX = 128;

/** `|h[name]|h` — the name may hold neither `]` nor `|` (no nesting). */
const DISPLAY_RE = /\|h\[([^\]|]{1,600})\]\|h/;
/** `|cnIQ<n>:` — the client's item-quality colour token. */
const QUALITY_RE = /\|cnIQ([0-7]):/;
/** C0/C1 controls plus format chars (bidi overrides, zero-width, BOM). */
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;

export interface LinkDisplay {
  name?: string;
  quality?: number;
}

/** Cut to `max` code units without leaving a dangling high surrogate. */
function capUtf16(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(max - 1);
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return whole.trimEnd();
}

function linkName(link: string): string | undefined {
  const raw = DISPLAY_RE.exec(link)?.[1];
  if (raw === undefined) return undefined;
  const clean = raw.replace(CONTROL_RE, '').trim();
  return clean ? capUtf16(clean, LINK_NAME_MAX) : undefined;
}

/** Name + quality from a raw item link; each is omitted when absent/malformed. */
export function parseLinkDisplay(link: string): LinkDisplay {
  const name = linkName(link);
  const quality = QUALITY_RE.exec(link)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
    ...(quality !== undefined ? { quality: Number(quality) } : {}),
  };
}
