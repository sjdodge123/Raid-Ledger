import type { ItemTooltipStat } from '@raid-ledger/contract';

/**
 * ROK-2176: the Equip:/Use:/Chance on hit: lines of a Wowhead tooltip, and
 * the whitelist of Equip: effects that become diffable stats (operator Q3,
 * 2026-11-11). Anything not on the whitelist stays text-only.
 */

interface EffectRule {
  key: string;
  name: string;
  unit: 'flat' | 'percent';
  re: RegExp;
}

/** First matching rule wins; each regex captures the number. */
const EFFECT_RULES: readonly EffectRule[] = [
  {
    key: 'ATTACK_POWER',
    name: 'Attack Power',
    unit: 'flat',
    re: /^\+(\d+) Attack Power\.?$/,
  },
  {
    key: 'CRIT_PCT',
    name: 'Critical Strike',
    unit: 'percent',
    re: /critical strike by (\d+)%/,
  },
  {
    key: 'HIT_PCT',
    name: 'Hit',
    unit: 'percent',
    re: /chance to hit by (\d+)%/,
  },
  {
    key: 'SPELL_POWER',
    name: 'Spell Power',
    unit: 'flat',
    re: /damage and healing done by magical spells and effects by up to (\d+)/,
  },
  {
    key: 'HEALING',
    name: 'Healing',
    unit: 'flat',
    re: /healing done by spells and effects by up to (\d+)/,
  },
  {
    key: 'MP5',
    name: 'Mana per 5 sec',
    unit: 'flat',
    re: /Restores (\d+) mana per 5 sec/,
  },
  {
    key: 'DEFENSE',
    name: 'Defense',
    unit: 'flat',
    re: /Increased Defense \+(\d+)/,
  },
];

const EFFECT_SPAN_RE =
  /<span[^>]*class="q2">(Equip|Use|Chance on hit): (.*?)<\/span>/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&nbsp;': ' ',
};

/** Tags and comments stripped, common entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENTITIES[m] ?? m)
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
  for (const rule of EFFECT_RULES) {
    const m = rule.re.exec(text);
    if (m?.[1] !== undefined) {
      return {
        key: rule.key,
        name: rule.name,
        value: Number(m[1]),
        unit: rule.unit,
      };
    }
  }
  return null;
}
