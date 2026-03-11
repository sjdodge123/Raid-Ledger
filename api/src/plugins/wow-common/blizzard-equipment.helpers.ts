/**
 * Equipment fetching helpers for BlizzardService.
 * Extracted from blizzard.service.ts for file size compliance (ROK-719).
 */
import type { BlizzardCharacterEquipment } from './blizzard.constants';
import {
  buildCharacterParams,
  buildEquipmentResult,
} from './blizzard-character.helpers';

type Logger = { warn: (msg: string) => void; log: (msg: string) => void };

/** Parse raw equipment response. */
function parseEquipmentResponse(json: unknown) {
  return json as {
    equipped_item_level?: number;
    equipped_items?: Array<{
      item: { id: number };
      media?: { key?: { href: string } };
    }>;
  };
}

/** Fetch a single item's icon URL from its media endpoint. */
async function fetchSingleIconUrl(
  itemId: number,
  mediaHref: string,
  token: string,
  result: Map<number, string>,
): Promise<void> {
  try {
    const res = await fetch(mediaHref, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const media = (await res.json()) as {
      assets?: Array<{ key: string; value: string }>;
    };
    const icon = media.assets?.find((a) => a.key === 'icon');
    if (icon?.value) {
      const iconMatch = icon.value.match(/icons\/\d+\/(.+)$/);
      result.set(
        itemId,
        iconMatch
          ? `https://render.worldofwarcraft.com/us/icons/56/${iconMatch[1]}`
          : icon.value,
      );
    }
  } catch {
    /* Non-fatal */
  }
}

/** Batch-fetch item icon URLs from Blizzard media endpoints. */
async function fetchItemIconUrls(
  data: {
    equipped_items?: Array<{
      item: { id: number };
      media?: { key?: { href: string } };
    }>;
  },
  token: string,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const items = (data.equipped_items ?? [])
    .filter((i) => i.media?.key?.href)
    .map((i) => ({ itemId: i.item.id, mediaHref: i.media!.key!.href }));
  if (items.length === 0) return result;
  await Promise.all(
    items.map(({ itemId, mediaHref }) =>
      fetchSingleIconUrl(itemId, mediaHref, token, result),
    ),
  );
  return result;
}

/** Log a sample of equipment items for debugging. */
function logEquipmentSample(
  charName: string,
  result: BlizzardCharacterEquipment,
  logger: Logger,
): void {
  if (result.items.length === 0) return;
  const sample = result.items
    .slice(0, 3)
    .map((i) => `${i.name}: quality=${i.quality}, iLvl=${i.itemLevel}`);
  logger.log(
    `Equipment for ${charName}: ${result.items.length} items. Sample: [${sample.join('; ')}]`,
  );
}

/** Fetch raw equipment data from the Blizzard API. */
async function fetchRawEquipment(
  name: string,
  realm: string,
  region: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
) {
  const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(
    name,
    realm,
    region,
    apiNamespacePrefix,
  );
  const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/equipment?namespace=${namespace}&locale=en_US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logger.warn(
      `Equipment fetch failed for ${charName}-${realmSlug}: ${res.status}`,
    );
    return null;
  }
  return {
    data: parseEquipmentResponse(await res.json()),
    token,
    charName,
  };
}

/** Fetch a WoW character's equipped items from the Blizzard API. */
export async function fetchCharacterEquipment(
  name: string,
  realm: string,
  region: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
): Promise<BlizzardCharacterEquipment | null> {
  try {
    const raw = await fetchRawEquipment(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      logger,
    );
    if (!raw) return null;
    const iconUrls = await fetchItemIconUrls(raw.data, raw.token);
    const result = buildEquipmentResult(
      raw.data as {
        equipped_item_level?: number;
        equipped_items?: Record<string, unknown>[];
      },
      iconUrls,
    );
    logEquipmentSample(raw.charName, result, logger);
    return result;
  } catch (err) {
    logger.warn(`Failed to fetch character equipment: ${err}`);
    return null;
  }
}
