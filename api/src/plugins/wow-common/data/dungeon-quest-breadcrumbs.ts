/**
 * ROK-2221 (operator APPLY ruling): optional breadcrumb steps. Each is a
 * bundled "go and speak to <NPC>" quest whose Blizzard `quest/{id}` text has
 * no item, kill or escort objective, and the NPC it sends you to is the giver
 * of the next step. They stay in the prerequisite chain for display (the
 * card's "Requires:" line), but readiness `prereqsMet` does not wait on them:
 * a player who walked to the giver without the breadcrumb is still ready.
 *
 * Only true prerequisites gate readiness. Keyed by quest id; value = name,
 * pinned against the bundled data by the integrity spec.
 */
export const OPTIONAL_BREADCRUMBS: ReadonlyMap<number, string> = new Map([
  // Wailing Caverns, Horde: Crossroads -> Thunder Bluff -> 914 Leaders of the Fang.
  [1489, 'Hamuul Runetotem'],
  [1490, 'Nara Wildmane'],
  // Blackfathom Deeps, Alliance: Stormwind -> Auberdine, 1275 Researching the Corruption.
  [3765, 'The Corruption Abroad'],
]);

/** True for a step that is shown in the chain but never gates readiness. */
export function isOptionalBreadcrumb(questId: number): boolean {
  return OPTIONAL_BREADCRUMBS.has(questId);
}
