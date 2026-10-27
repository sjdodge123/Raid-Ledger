/**
 * ROK-2014 — DEMO_MODE container history for the containers fixture
 * (`trendDays: 3`): three earlier play days dated scan-day−1, −3 and −6 (the
 * fixture scan's own play day, in the server tz → UTC chain the importer
 * uses), built BACKWARDS from the fixture scan so the newest day ends where
 * the Materials tab is. Each plan entry is that day's change vs the day
 * before (the chip's delta):
 *
 * | day | change |
 * |---|---|
 * | −0 (scan) | shared Wood +20, Stone −10 (the net drop) |
 * | −1 | shared Wood +15, personal Coins +100, cart Wood +40 |
 * | −3 | shared Wood +10, BlackMetal +60 |
 *
 * → shared Wood (no vehicles) "+45 over 3 days", with vehicles +85.
 * Written through the real {@link writeContainerDay}, so base rows match.
 */
import type {
  ValheimContainer,
  ValheimContainersMessage,
} from '@raid-ledger/contract';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import {
  CONTAINERS_BASIC,
  DEMO_PRIVATE_CHEST,
  DEMO_SHARED_CHEST,
} from './valheim-armory-containers-demo-fixture';
import { writeContainerDay } from './valheim-container-days.repository';
import { playDateIn, resolvePlayTimezone } from './valheim-skill-days.helpers';
import { selectServerTimezone } from './valheim-skill-days.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The `trendDays` seed option: none (the default) or the 3-day trend. */
export const DEMO_CONTAINER_TREND_DAYS = [0, 3] as const;
export type DemoContainerTrendDays = (typeof DEMO_CONTAINER_TREND_DAYS)[number];

type ChestRef = Pick<ValheimContainer, 'prefab' | 'x' | 'z'>;
const at = (c: ChestRef): ChestRef => ({ prefab: c.prefab, x: c.x, z: c.z });
const byPrefab = (prefab: string): ChestRef => {
  const hit = CONTAINERS_BASIC.find((c) => c.prefab === prefab);
  if (!hit) throw new Error(`containers demo: no ${prefab} chest`);
  return at(hit);
};

/** One chest item's change on a day: that day's end minus the day before. */
export interface DemoContainerChange {
  chest: ChestRef;
  item: string;
  gain: number;
}

/** Newest first: the play day the change lands on (days before the scan). */
export const DEMO_CONTAINER_DAY_PLAN: readonly {
  daysAgo: number;
  changes: readonly DemoContainerChange[];
}[] = [
  {
    daysAgo: 0,
    changes: [
      { chest: at(DEMO_SHARED_CHEST), item: 'Wood', gain: 20 },
      { chest: at(DEMO_SHARED_CHEST), item: 'Stone', gain: -10 },
    ],
  },
  {
    daysAgo: 1,
    changes: [
      { chest: at(DEMO_SHARED_CHEST), item: 'Wood', gain: 15 },
      { chest: at(DEMO_PRIVATE_CHEST), item: 'Coins', gain: 100 },
      { chest: byPrefab('Cart'), item: 'Wood', gain: 40 },
    ],
  },
  {
    daysAgo: 3,
    changes: [
      { chest: at(DEMO_SHARED_CHEST), item: 'Wood', gain: 10 },
      {
        chest: byPrefab('piece_chest_blackmetal'),
        item: 'BlackMetal',
        gain: 60,
      },
    ],
  },
];

/** Days of each stored prior snapshot before the scan (−1, −3, −6). */
const PRIOR_DAYS_AGO = [1, 3, 6] as const;

const sameChest = (c: ValheimContainer, r: ChestRef) =>
  c.prefab === r.prefab && c.x === r.x && c.z === r.z;

/** `msg` as it stood the day before `changes` (each gain undone; ≤ 0 → gone). */
export function undoChanges(
  msg: ValheimContainersMessage,
  changes: readonly DemoContainerChange[],
): ValheimContainersMessage {
  const containers = msg.containers.map((c) => {
    const mine = changes.filter((ch) => sameChest(c, ch.chest));
    if (mine.length === 0) return c;
    const items = c.items
      .map((s) => {
        const gain = mine.find((ch) => ch.item === s.prefab)?.gain ?? 0;
        return { ...s, stack: s.stack - gain };
      })
      .filter((s) => s.stack > 0);
    return { ...c, items };
  });
  return { ...msg, containers };
}

/** The three prior days' messages, newest first, chained from `msg`. */
export function demoPriorDays(
  msg: ValheimContainersMessage,
): { daysAgo: number; msg: ValheimContainersMessage }[] {
  let end = msg;
  return DEMO_CONTAINER_DAY_PLAN.map(({ changes }, i) => {
    end = undoChanges(end, changes);
    return { daysAgo: PRIOR_DAYS_AGO[i] ?? i + 1, msg: end };
  });
}

/** Write the prior play days for the fixture scan `msg` (no-op for 0). */
export async function seedDemoContainerDays(
  tx: ValheimLinkTx,
  pelicanServerId: number,
  msg: ValheimContainersMessage,
  count: DemoContainerTrendDays,
): Promise<void> {
  if (count === 0) return;
  const serverTz = await selectServerTimezone(tx, pelicanServerId);
  const tz = resolvePlayTimezone(serverTz, null);
  const scanAt = Date.parse(msg.capturedAt);
  for (const day of demoPriorDays(msg)) {
    const capturedAt = new Date(scanAt - day.daysAgo * DAY_MS);
    const playDate = playDateIn(capturedAt, tz);
    const worldUid = msg.worldUid;
    const ref = { pelicanServerId, worldUid, playDate, capturedAt };
    await writeContainerDay(tx, ref, day.msg);
  }
}
