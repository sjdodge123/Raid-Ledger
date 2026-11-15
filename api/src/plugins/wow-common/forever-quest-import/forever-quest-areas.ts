/**
 * ROK-1908: every quest area the Forever quest import crawls — the 19
 * classic dungeons ({@link CLASSIC_QUEST_AREAS}) plus one target per
 * Forever quest area of each Forever-new instance. The Forever areas are
 * DERIVED from the instance catalogue's `foreverQuestAreaIds` (City of
 * Dalaran has two: 16544 and 16560); nothing here hand-maps an id. Area 279
 * ("Dalaran", the city outside) is in no catalogue row, so its quests are
 * fetched only as prerequisites.
 */
import { foreverNewRows } from '../instance-catalogue/instance-catalogue';
import type { CatalogueInstance } from '../instance-catalogue/instance-catalogue.types';
import {
  CLASSIC_QUEST_AREAS,
  classicQuestAreaInstanceIds,
  type ClassicQuestArea,
} from './classic-quest-areas';

/** One `quest/area/{id}` the crawl lists, and the dungeon it imports into. */
export interface QuestAreaTarget {
  instanceId: number;
  entry: ClassicQuestArea;
}

/** One target per catalogue Forever quest area of a Forever-new row. */
function rowTargets(row: CatalogueInstance): QuestAreaTarget[] {
  const areaNames = row.questName ? [row.name, row.questName] : [row.name];
  return row.foreverQuestAreaIds.map((areaId) => ({
    instanceId: row.id,
    entry: { dungeon: row.name, areaId, areaNames, verified: false },
  }));
}

/** The Forever-new instances' quest areas, in catalogue order. */
export function foreverQuestAreaTargets(): QuestAreaTarget[] {
  return foreverNewRows().flatMap(rowTargets);
}

/** Every area the crawl lists: classic dungeons, then the Forever-new ones. */
export function questAreaTargets(): QuestAreaTarget[] {
  const classic = classicQuestAreaInstanceIds().flatMap((instanceId) => {
    const entry = CLASSIC_QUEST_AREAS[instanceId];
    return entry ? [{ instanceId, entry }] : [];
  });
  return [...classic, ...foreverQuestAreaTargets()];
}

/** An instance's first crawled area (its unlisted quests' area), else null. */
export function primaryQuestArea(instanceId: number): ClassicQuestArea | null {
  return (
    questAreaTargets().find((t) => t.instanceId === instanceId)?.entry ?? null
  );
}
