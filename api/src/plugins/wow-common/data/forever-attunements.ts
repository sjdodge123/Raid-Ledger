/**
 * ROK-1927 — the WoW: Forever attunement map: a hand-kept, PR-reviewed static
 * dataset (spec D1, no DB table). Chain order and quest ids come from classic
 * 1.12 knowledge (operator ruling 2026-11-12 A: no Wowhead captures); every id
 * is confirmed against Blizzard's Forever `quest/{id}` by the ROK-2143 quest
 * import, which fetches {@link attunementExtraQuestIds} besides its dungeon
 * areas. An id Blizzard does not confirm stays hidden (ruling B).
 *
 * Completing the LAST required quest alone counts as attuned (ruling Q3);
 * earlier steps only drive "in progress" and the checklist. Key items are
 * tracked through the quest that awards them; reputation gates are
 * `trackable: false` until reputations are synced (ruling D).
 */

export type AttunementStanding = 'friendly' | 'honored' | 'revered' | 'exalted';

export type AttunementStep =
  | { kind: 'quest'; questId: number; label: string; optional?: true }
  | { kind: 'level'; min: number; label: string }
  | { kind: 'item'; itemId: number; label: string }
  | {
      kind: 'reputation';
      factionId: number;
      standing: AttunementStanding;
      label: string;
    };

export type AttunementQuestStep = Extract<AttunementStep, { kind: 'quest' }>;

export type AttunementFaction = 'horde' | 'alliance' | 'both';

export interface AttunementDef {
  /** Stable id, e.g. `ony-horde`. */
  key: string;
  /** Groups faction variants into one summary row (spec D7). */
  groupKey: string;
  /** Display name, e.g. `Molten Core`. */
  instance: string;
  faction: AttunementFaction;
  /** Ordered; the last required quest step is the "attuned" proof. */
  steps: readonly AttunementStep[];
  /** False = listed greyed as "not tracked yet". */
  trackable: boolean;
  /** ISO date the ids were confirmed against Forever; null = unconfirmed. */
  verifiedOn: string | null;
  /** Where the ids came from. */
  source: string;
}

const CLASSIC_SOURCE =
  'classic 1.12 chain, ids confirmed via Blizzard Forever quest/{id}';

/** Argent Dawn (classic faction id). */
const ARGENT_DAWN_FACTION_ID = 529;

function quest(questId: number, label: string): AttunementQuestStep {
  return { kind: 'quest', questId, label };
}

function level(min: number): AttunementStep {
  return { kind: 'level', min, label: `Reach level ${min}` };
}

/** Required level from the bundled classic quest rows (requiredLevel 55). */
const MC_HORDE: readonly AttunementStep[] = [
  level(55),
  quest(7487, 'Attunement to the Core'),
];

const MC_ALLIANCE: readonly AttunementStep[] = [
  level(55),
  quest(7848, 'Attunement to the Core'),
];

const ONY_HORDE: readonly AttunementStep[] = [
  level(55),
  quest(4903, "Warlord's Command"),
  quest(4941, "Eitrigg's Wisdom"),
  quest(4974, 'For The Horde!'),
  quest(6566, 'What the Wind Carries'),
  quest(6567, 'The Champion of the Horde'),
  quest(6568, 'The Testament of Rexxar'),
  quest(6569, 'Oculus Illusions'),
  quest(6570, 'Emberstrife'),
  quest(6582, 'The Test of Skulls, Scryer'),
  quest(6583, 'The Test of Skulls, Somnus'),
  quest(6584, 'The Test of Skulls, Chronalis'),
  quest(6585, 'The Test of Skulls, Axtroz'),
  quest(6601, 'Ascension...'),
  quest(6602, 'Blood of the Black Dragon Champion'),
];

/** No level step: the chain's first quest is not in the bundled rows. */
const ONY_ALLIANCE: readonly AttunementStep[] = [
  quest(4182, 'Dragonkin Menace'),
  quest(4183, 'The True Masters (Magistrate Solomon)'),
  quest(4184, 'The True Masters (Highlord Bolvar)'),
  quest(4185, 'The True Masters (Lady Prestor)'),
  quest(4186, 'The True Masters (Highlord Bolvar)'),
  quest(4223, 'The True Masters (Magistrate Solomon)'),
  quest(4224, 'The True Masters (Ragged John)'),
  quest(4241, 'Marshal Windsor'),
  quest(4242, 'Abandoned Hope'),
  quest(4264, 'A Crumpled Up Note'),
  quest(4282, 'A Shred of Hope'),
  quest(4322, 'Jail Break!'),
  quest(6402, 'Stormwind Rendezvous'),
  quest(6403, 'The Great Masquerade'),
  quest(6501, "The Dragon's Eye"),
  quest(6502, 'Drakefire Amulet'),
];

const BWL: readonly AttunementStep[] = [
  level(55),
  quest(7761, "Blackhand's Command"),
];

/** Reputation gate: not trackable until reputations sync (separate story). */
const NAXX: readonly AttunementStep[] = [
  {
    kind: 'reputation',
    factionId: ARGENT_DAWN_FACTION_ID,
    standing: 'honored',
    label: 'Honored with the Argent Dawn',
  },
];

function def(
  key: string,
  groupKey: string,
  instance: string,
  faction: AttunementFaction,
  steps: readonly AttunementStep[],
  trackable = true,
): AttunementDef {
  return {
    key,
    groupKey,
    instance,
    faction,
    steps,
    trackable,
    verifiedOn: null,
    source: CLASSIC_SOURCE,
  };
}

export const FOREVER_ATTUNEMENTS: readonly AttunementDef[] = [
  def('mc-horde', 'mc', 'Molten Core', 'horde', MC_HORDE),
  def('mc-alliance', 'mc', 'Molten Core', 'alliance', MC_ALLIANCE),
  def('ony-horde', 'onyxia', "Onyxia's Lair", 'horde', ONY_HORDE),
  def('ony-alliance', 'onyxia', "Onyxia's Lair", 'alliance', ONY_ALLIANCE),
  def('bwl', 'bwl', 'Blackwing Lair', 'both', BWL),
  def('naxx', 'naxx', 'Naxxramas', 'both', NAXX, false),
];

/** The quest steps of a definition, in chain order. */
export function attunementQuestSteps(
  attunement: AttunementDef,
): AttunementQuestStep[] {
  return attunement.steps.filter(
    (s): s is AttunementQuestStep => s.kind === 'quest',
  );
}

/** The required quest whose completion alone proves "attuned" (ruling Q3). */
export function finalAttunementQuest(
  attunement: AttunementDef,
): AttunementQuestStep | null {
  const required = attunementQuestSteps(attunement).filter((s) => !s.optional);
  return required[required.length - 1] ?? null;
}

/**
 * Every attunement quest id, ascending and unique — the "extra ids" the
 * ROK-2143 Forever quest import fetches so Blizzard confirms each one.
 */
export function attunementExtraQuestIds(
  attunements: readonly AttunementDef[] = FOREVER_ATTUNEMENTS,
): number[] {
  const ids = new Set<number>();
  for (const a of attunements) {
    for (const step of attunementQuestSteps(a)) ids.add(step.questId);
  }
  return [...ids].sort((x, y) => x - y);
}
