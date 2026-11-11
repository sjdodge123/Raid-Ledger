import { ItemTooltipSchema } from '@raid-ledger/contract';
import type { ItemTooltip, ItemTooltipStat } from '@raid-ledger/contract';
import type { WowheadEnv } from './wowhead-item.types';
import {
  effectToStat,
  htmlToText,
  parseEffects,
} from './wowhead-tooltip.effects';

/**
 * ROK-2176: pure parser for the `tooltip` HTML of Wowhead's tooltip
 * endpoint. Reads Wowhead's comment markers (`<!--ilvl-->`, `<!--amr-->`,
 * `<!--statN-->`, `<!--rs-->`…); fixtures in `testing/fixtures/wowhead/`.
 * Never throws: a missing marker leaves its field null/empty, and HTML that
 * is absent, not a string, over 64 KB or has no `<!--ilvl-->` yields null.
 */

export const WOWHEAD_TOOLTIP_MAX_BYTES = 64 * 1024;

/** `<!--stat50-->` "+40 Armor" is bonus armor, kept apart from base armor. */
const BONUS_ARMOR_STAT_ID = '50';
const RANDOM_ENCHANT_RE = /&lt;Random enchantment&gt;|<Random enchantment>/;
const SLOT_RE =
  /<table width="100%"><tr><td>([^<]*)<\/td>(?:<th>(?:<!--[^>]*-->)?<span[^>]*>([^<]*)<\/span>)?/;
const STAT_RE = /<!--stat(\d+)-->([+-]\d+) ([A-Za-z ]+)<\/span>/g;
const RESIST_RE = /([+-]\d+) (Arcane|Fire|Frost|Nature|Shadow) Resistance/g;
const SET_RE = /item-set=\d+\/[^"]*" class="q">([^<]+)<\/a>/;

/** Canonical stat key from a display name: "Fire Resistance" → FIRE_RESISTANCE. */
export function toStatKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function intMatch(html: string, re: RegExp): number | null {
  const m = re.exec(html);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}

function emptyToNull(s: string | undefined): string | null {
  const text = htmlToText(s ?? '');
  return text === '' ? null : text;
}

/** Text between two markers, or '' when either is missing. */
function between(html: string, start: string, end: string): string {
  const i = html.indexOf(start);
  if (i < 0) return '';
  const j = html.indexOf(end, i + start.length);
  return j < 0 ? '' : html.slice(i + start.length, j);
}

function parseBinding(html: string): {
  binding: string | null;
  unique: boolean;
} {
  const parts = between(html, '<!--bo-->', '<!--ue-->')
    .split(/<br\s*\/?>/)
    .map((p) => htmlToText(p))
    .filter((p) => p !== '');
  const binding = parts.find((p) => p.startsWith('Binds')) ?? null;
  return { binding, unique: parts.some((p) => p.startsWith('Unique')) };
}

function parseSlot(html: string): {
  slotLabel: string | null;
  subclass: string | null;
} {
  const m = SLOT_RE.exec(html);
  return { slotLabel: emptyToNull(m?.[1]), subclass: emptyToNull(m?.[2]) };
}

function parseWeapon(html: string): ItemTooltip['weapon'] {
  const dmg = /<!--dmg-->(\d+) - (\d+)(?: [A-Za-z]+)? Damage/.exec(html);
  const spd = /<!--spd-->([\d.]+)/.exec(html);
  const dps = /<!--dps-->\(([\d.]+) damage per second\)/.exec(html);
  if (!dmg?.[1] || !dmg[2] || !spd?.[1] || !dps?.[1]) return null;
  return {
    damageMin: Number(dmg[1]),
    damageMax: Number(dmg[2]),
    attackSpeed: Number(spd[1]),
    dps: Number(dps[1]),
  };
}

function primaryStats(html: string): ItemTooltipStat[] {
  const out: ItemTooltipStat[] = [];
  for (const m of html.matchAll(STAT_RE)) {
    const [, id, value, rawName] = m;
    if (!id || !value || !rawName) continue;
    const name = id === BONUS_ARMOR_STAT_ID ? 'Bonus Armor' : rawName.trim();
    out.push({
      key: toStatKey(name),
      name,
      value: Number(value),
      unit: 'flat',
    });
  }
  return out;
}

function resistances(html: string): ItemTooltipStat[] {
  const out: ItemTooltipStat[] = [];
  for (const m of between(html, '<!--rs-->', '<!--e-->').matchAll(RESIST_RE)) {
    const [, value, school] = m;
    if (!value || !school) continue;
    const name = `${school} Resistance`;
    out.push({
      key: toStatKey(name),
      name,
      value: Number(value),
      unit: 'flat',
    });
  }
  return out;
}

/** Same-key stats (two AP effects) are summed, first occurrence keeps its slot. */
function mergeStats(stats: ItemTooltipStat[]): ItemTooltipStat[] {
  const byKey = new Map<string, ItemTooltipStat>();
  for (const s of stats) {
    const prev = byKey.get(s.key);
    byKey.set(s.key, prev ? { ...prev, value: prev.value + s.value } : s);
  }
  return [...byKey.values()];
}

function buildTooltip(html: string, env: WowheadEnv): ItemTooltip {
  const effects = parseEffects(html);
  const effectStats = effects
    .map(effectToStat)
    .filter((s): s is ItemTooltipStat => s !== null);
  const setMatch = SET_RE.exec(html);
  return {
    env,
    ...parseSlot(html),
    ...parseBinding(html),
    requiredLevel: intMatch(html, /<!--rlvl-->(\d+)/),
    armor: intMatch(html, /<!--amr-->(\d+) Armor/),
    weapon: parseWeapon(html),
    stats: mergeStats([
      ...primaryStats(html),
      ...resistances(html),
      ...effectStats,
    ]),
    effects,
    setName: emptyToNull(setMatch?.[1]),
    randomEnchant: RANDOM_ENCHANT_RE.test(html),
  };
}

/** Parse one item's tooltip HTML; null when unusable. Never throws. */
export function parseTooltipHtml(
  html: unknown,
  env: WowheadEnv,
): ItemTooltip | null {
  if (typeof html !== 'string') return null;
  if (Buffer.byteLength(html, 'utf8') > WOWHEAD_TOOLTIP_MAX_BYTES) return null;
  if (!/<!--ilvl-->\d+/.test(html)) return null;
  try {
    const parsed = ItemTooltipSchema.safeParse(buildTooltip(html, env));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
