/**
 * High-level instance API orchestration helpers for BlizzardService.
 * Composes the lower-level helpers in blizzard-instance.helpers.ts.
 *
 * ROK-2210: `classic_era` and `wow_forever` are served from the instance
 * catalogue (no token, no cache, no Blizzard call); every other variant keeps
 * the live journal.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import type { WowGameVariant } from '@raid-ledger/contract';
import type {
  InstanceListCacheData,
  WowInstanceDetail,
} from './blizzard.constants';
import * as instH from './blizzard-instance.helpers';
import { blizzardUpstreamError } from './blizzard-upstream-error';
import * as catalogue from './instance-catalogue/instance-catalogue';

/** Journal ids stay below this; wings (31601, 22901) and 900000xx do not. */
const LAST_JOURNAL_ID = 10_000;

/** The catalogue list for a catalogue-served variant, else null (journal). */
export function catalogueInstanceList(
  gameVariant: WowGameVariant,
): InstanceListCacheData | null {
  if (!catalogue.servesVariant(gameVariant)) return null;
  const list = (c: 'dungeon' | 'raid') =>
    catalogue.listInstances(gameVariant, c).map(catalogue.toListDto);
  return { dungeons: list('dungeon'), raids: list('raid') };
}

/**
 * D6: a catalogue variant resolves (id, variant) then any variant, so a saved
 * event's id resolves whatever the viewer's variant. A journal variant only
 * resolves the synthetic ids the journal does not know (wings, Forever-new);
 * real journal ids keep the journal path. Null = ask the journal.
 */
export function catalogueInstanceDetail(
  instanceId: number,
  gameVariant: WowGameVariant,
): WowInstanceDetail | null {
  let row = null;
  if (catalogue.servesVariant(gameVariant))
    row =
      catalogue.getInstance(instanceId, gameVariant) ??
      catalogue.getAnyVariant(instanceId);
  else if (instanceId > LAST_JOURNAL_ID)
    row =
      catalogue.getInstance(instanceId, 'classic_era') ??
      catalogue.getAnyVariant(instanceId);
  return row ? catalogue.toDetailDto(row) : null;
}

/** Journal-served variants (retail, classic, classic_anniversary). */
export async function fetchAllInstancesFromApi(
  region: string,
  gameVariant: WowGameVariant,
  token: string,
): Promise<InstanceListCacheData> {
  const tiers = await instH.fetchExpansionIndex(region, token);
  const details = await instH.fetchExpansionDetails(
    tiers,
    `https://${region}.api.blizzard.com`,
    `static-${region}`,
    token,
  );
  let { dungeons, raids } = instH.mergeExpansionInstances(details);
  ({ dungeons, raids } = instH.filterByVariant(dungeons, raids, gameVariant));
  dungeons = instH.deduplicateById(dungeons);
  raids = instH.deduplicateById(raids);
  if (gameVariant !== 'retail') {
    dungeons = instH.expandSubInstances(dungeons);
    raids = instH.expandSubInstances(raids);
  }
  return {
    dungeons: dungeons.map((i) => instH.enrichInstance(i, gameVariant)),
    raids: raids.map((i) => instH.enrichInstance(i, gameVariant)),
  };
}

/** A failed journal-instance call: an unknown id is a 404, the rest a 502. */
function instanceDetailError(
  status: number,
  instanceId: number,
): HttpException {
  if (status === 404)
    return new NotFoundException(`Instance ${instanceId} not found`);
  return blizzardUpstreamError(
    status,
    'instances',
    `Failed to fetch instance detail from Blizzard (${status}). Please try again later.`,
  );
}

export async function fetchInstanceDetailFromApi(
  instanceId: number,
  region: string,
  gameVariant: WowGameVariant,
  token: string,
): Promise<WowInstanceDetail> {
  const url = `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw instanceDetailError(res.status, instanceId);
  const data = (await res.json()) as {
    id: number;
    name: string;
    minimum_level?: number;
    modes?: Array<{ mode: { type: string }; players: number }>;
    category?: { type: string };
    expansion?: { name: string };
  };
  return instH.buildInstanceDetail(data, gameVariant);
}
