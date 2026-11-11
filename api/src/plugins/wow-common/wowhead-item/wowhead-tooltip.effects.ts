import type { ItemTooltipStat } from '@raid-ledger/contract';

/**
 * ROK-2176: the Equip:/Use:/Chance on hit: lines of a Wowhead tooltip, and
 * the whitelist of Equip: effects that become diffable stats (operator Q3,
 * 2026-11-11). Anything not on the whitelist stays text-only.
 */

/** [key, display name, unit, regex capturing the number]. */
type EffectRule = readonly [string, string, 'flat' | 'percent', RegExp];

/** First matching rule wins. Spell crit / spell hit / dodge stay text-only. */
const EFFECT_RULES: readonly EffectRule[] = [
  ['ATTACK_POWER', 'Attack Power', 'flat', /^\+(\d+) Attack Power\.?$/],
  ['CRIT_PCT', 'Critical Strike', 'percent', /critical strike by (\d+)%/],
  ['HIT_PCT', 'Hit', 'percent', /chance to hit by (\d+)%/],
  [
    'SPELL_POWER',
    'Spell Power',
    'flat',
    /damage and healing done by magical spells and effects by up to (\d+)/,
  ],
  [
    'HEALING',
    'Healing',
    'flat',
    /healing done by spells and effects by up to (\d+)/,
  ],
  ['MP5', 'Mana per 5 sec', 'flat', /Restores (\d+) mana per 5 sec/],
  ['DEFENSE', 'Defense', 'flat', /Increased Defense \+(\d+)/],
];

const EFFECT_SPAN_RE =
  /<span[^>]*class="q2">(Equip|Use|Chance on hit): (.*?)<\/span>/g;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>' };

function decodeEntity(match: string, name: string): string {
  if (name.startsWith('#')) return String.fromCharCode(Number(name.slice(1)));
  if (name === 'quot') return '"';
  if (name === 'nbsp') return ' ';
  return ENTITIES[name] ?? match;
}

/** Tags and comments stripped, common entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d{1,5}|[a-z]+);/g, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every effect line as plain text: "Equip: +30 Attack Power.". */
export function parseEffects(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(EFFECT_SPAN_RE)) {
    const text = htmlToText(m[2] ?? '');
    if (text) out.push(`${m[1] ?? ''}: ${text}`);
  }
  return out;
}

/** The stat a single Equip: line maps to, or null when not whitelisted. */
export function effectToStat(effect: string): ItemTooltipStat | null {
  if (!effect.startsWith('Equip: ')) return null;
  const text = effect.slice('Equip: '.length);
  for (const [key, name, unit, re] of EFFECT_RULES) {
    const m = re.exec(text);
    if (m?.[1] !== undefined) return { key, name, value: Number(m[1]), unit };
  }
  return null;
}
