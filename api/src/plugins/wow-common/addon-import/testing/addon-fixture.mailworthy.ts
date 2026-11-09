import {
  ADDON_MAILWORTHY_DAYS_MAX,
  ADDON_MAILWORTHY_GIVERS_MAX,
  ADDON_MAILWORTHY_NAME_MAX,
  ADDON_MAILWORTHY_PEERS_MAX,
  type AddonCharExport,
  type AddonMailworthy,
} from '@raid-ledger/contract';
import { FIXTURE_EXPORTED_AT, buildCharPayload } from './addon-fixture.builder';

/**
 * ROK-2148 golden-fixture builders for the optional `char` `data.mailworthy`
 * block (CONTRACT.md §3). All names are synthetic: the exporter is the
 * builder's `Ana Forever` of "Night Shift"; recipients/peers/author reuse the
 * `buildMember(i)` names (`Member<i>`) so roster-backed specs can match them.
 */
export const MAILWORTHY_GENERATED_AT = FIXTURE_EXPORTED_AT - 60;
/** UTC day number of `MAILWORTHY_GENERATED_AT`. */
export const MAILWORTHY_TODAY = Math.floor(MAILWORTHY_GENERATED_AT / 86_400);
export const MAILWORTHY_TEMPLATE_REV = FIXTURE_EXPORTED_AT - 5 * 86_400;

/** Template: Enchanting, Alchemy, Blacksmithing (spec §A.6). */
export function buildMailworthyTemplate(): NonNullable<
  AddonMailworthy['template']
> {
  return {
    rev: MAILWORTHY_TEMPLATE_REV,
    author: 'Member1',
    rules: [
      { professionSkillLineId: 333, recipientName: 'Member2' },
      { professionSkillLineId: 171, recipientName: 'Member3' },
      { professionSkillLineId: 164, recipientName: 'Ana Forever' },
    ],
  };
}

/**
 * Full block: template, 4 peers, 3 givers — exporter + one alt (`asOf` =
 * `generatedAt`) and guildmate `Member2`, whose totals Mailworthy relayed in
 * game two hours earlier (delta 2026-11-08).
 */
export function buildMailworthyBlock(): AddonMailworthy {
  return {
    generatedAt: MAILWORTHY_GENERATED_AT,
    template: buildMailworthyTemplate(),
    peers: [1, 2, 3, 4].map((i) => ({
      name: `Member${i}`,
      lastSeenAt: MAILWORTHY_GENERATED_AT - i * 3_600,
    })),
    givers: buildMailworthyGivers(MAILWORTHY_TODAY),
  };
}

/** The full block's givers, keyed off UTC day `d`. */
function buildMailworthyGivers(
  d: number,
): NonNullable<AddonMailworthy['givers']> {
  return [
    {
      characterName: 'Ana Forever',
      itemsAllTime: 140,
      countingSince: FIXTURE_EXPORTED_AT - 90 * 86_400,
      asOf: MAILWORTHY_GENERATED_AT,
      days: [
        { day: d - 31, items: 20 },
        { day: d - 29, items: 12 },
        { day: d, items: 8 },
      ],
    },
    {
      characterName: 'Anabelle Forever',
      itemsAllTime: 20,
      countingSince: FIXTURE_EXPORTED_AT - 10 * 86_400,
      asOf: MAILWORTHY_GENERATED_AT,
      days: [{ day: d - 2, items: 20 }],
    },
    {
      characterName: 'Member2',
      itemsAllTime: 64,
      countingSince: FIXTURE_EXPORTED_AT - 30 * 86_400,
      asOf: MAILWORTHY_GENERATED_AT - 2 * 3_600,
      days: [
        { day: d - 6, items: 40 },
        { day: d - 1, items: 24 },
      ],
    },
  ];
}

/** `char-mailworthy`: the default char export + the full block. */
export function buildCharMailworthyPayload(
  mailworthy: AddonMailworthy = buildMailworthyBlock(),
): AddonCharExport {
  const payload = buildCharPayload();
  return { ...payload, data: { ...payload.data, mailworthy } };
}

/** A char export whose block breaks the contract (invalid fixtures only). */
function withInvalidBlock(mailworthy: object): object {
  const payload = buildCharPayload();
  return { ...payload, data: { ...payload.data, mailworthy } };
}

/** `char-mailworthy-template-only`: `generatedAt` + `template`, no lists. */
export function buildCharMailworthyTemplateOnlyPayload(): AddonCharExport {
  return buildCharMailworthyPayload({
    generatedAt: MAILWORTHY_GENERATED_AT,
    template: buildMailworthyTemplate(),
  });
}

/** Invalid: a rule carrying the per-unit `cap` Mailworthy never sends. */
export function buildCharMailworthyRuleCapPayload(): object {
  const template = buildMailworthyTemplate();
  const rules = template.rules.map((r) => ({ ...r, cap: 500 }));
  return withInvalidBlock({
    generatedAt: MAILWORTHY_GENERATED_AT,
    template: { ...template, rules },
  });
}

/** Invalid: nine rules (cap is eight, one per crafting profession). */
export function buildCharMailworthyTooManyRulesPayload(): object {
  const rules = Array.from({ length: 9 }, (_, i) => ({
    professionSkillLineId: 100 + i,
    recipientName: `Member${i + 1}`,
  }));
  return withInvalidBlock({
    generatedAt: MAILWORTHY_GENERATED_AT,
    template: { ...buildMailworthyTemplate(), rules },
  });
}

/**
 * Size worst case (spec §A.4 / R5): every array at its cap (200 givers ×
 * 35 days since the in-game sharing delta), 48-char names.
 */
export function buildMailworthyWorstCaseBlock(): AddonMailworthy {
  const name = (prefix: string, i: number) =>
    `${prefix}${i}`.padEnd(ADDON_MAILWORTHY_NAME_MAX, 'x');
  const days = Array.from({ length: ADDON_MAILWORTHY_DAYS_MAX }, (_, i) => ({
    day: MAILWORTHY_TODAY - i,
    items: 1_000 + i,
  })).reverse();
  return {
    generatedAt: MAILWORTHY_GENERATED_AT,
    template: buildMailworthyTemplate(),
    peers: Array.from({ length: ADDON_MAILWORTHY_PEERS_MAX }, (_, i) => ({
      name: name('Peer', i),
      lastSeenAt: MAILWORTHY_GENERATED_AT - i,
    })),
    givers: Array.from({ length: ADDON_MAILWORTHY_GIVERS_MAX }, (_, i) => ({
      characterName: name('Giver', i),
      itemsAllTime: 100_000 + i,
      countingSince: FIXTURE_EXPORTED_AT - 400 * 86_400,
      asOf: MAILWORTHY_GENERATED_AT - i,
      days,
    })),
  };
}
