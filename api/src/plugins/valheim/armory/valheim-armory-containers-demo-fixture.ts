/**
 * ROK-1853 L5 — the DEMO_MODE containers fixture: the golden
 * `packages/contract/valheim-link/v1/fixtures/containers-basic.json` and
 * `containers-private.json` merged into ONE scan of their shared world
 * (inlined — the runtime image does not ship the contract fixtures; the
 * seed's integration spec pins this copy to the golden files). Both share a
 * world and `capturedAt`, and a scan is latest-wins per world (D3), so two
 * separate imports would keep only the first; one merged message keeps every
 * chest under the real importer and its real public keys.
 *
 * Shared: 6 chests (one cart, one unreadable); private: 1, built by the
 * `c1` fixture identity's player id. Wood = 156 with vehicles, 57 without.
 */
import type {
  ValheimContainer,
  ValheimContainersMessage,
} from '@raid-ledger/contract';

type Stack = ValheimContainer['items'][number];

const s = (prefab: string, stack: number, quality = 1): Stack => ({
  prefab,
  quality,
  stack,
});

const CREATOR = '1000000000000001';
const base = {
  y: 32.5,
  creatorPlayerId: CREATOR,
  privacy: 'public' as const,
  vehicle: false,
  slots: 30,
  unreadable: false,
  omittedEntries: 0,
};

/** The first shared chest (Wood ×50 + Stone ×20) — the drill-down target. */
export const DEMO_SHARED_CHEST: ValheimContainer = {
  ...base,
  prefab: 'piece_chest_wood',
  x: -12.25,
  z: 48,
  usedSlots: 2,
  items: [s('Wood', 50), s('Stone', 20)],
};

/** The private chest (claimed → the owner's personal section). */
export const DEMO_PRIVATE_CHEST: ValheimContainer = {
  ...base,
  prefab: 'piece_chest_private',
  x: 5,
  z: 5,
  privacy: 'private',
  slots: 8,
  usedSlots: 1,
  items: [s('Coins', 999)],
};

/** `containers-basic.json`'s four containers (the cart is creator …002). */
export const CONTAINERS_BASIC: ValheimContainer[] = [
  DEMO_SHARED_CHEST,
  {
    ...base,
    prefab: 'piece_chest',
    x: 3,
    z: 51.5,
    usedSlots: 2,
    items: [s('SwordIron', 1, 2), s('Wood', 7)],
  },
  {
    ...base,
    prefab: 'piece_chest_blackmetal',
    x: 3,
    z: 60,
    slots: 48,
    usedSlots: 1,
    items: [s('BlackMetal', 120)],
  },
  {
    ...base,
    prefab: 'Cart',
    x: 20,
    z: 20,
    creatorPlayerId: '1000000000000002',
    vehicle: true,
    slots: 18,
    usedSlots: 1,
    items: [s('Wood', 99)],
  },
];

/** `containers-private.json`'s three containers. */
export const CONTAINERS_PRIVATE: ValheimContainer[] = [
  DEMO_PRIVATE_CHEST,
  {
    ...base,
    prefab: 'piece_chest',
    x: 9,
    z: 9,
    usedSlots: 0,
    unreadable: true,
    items: [],
  },
  {
    ...base,
    prefab: 'piece_chest_wood',
    x: 14,
    z: 14,
    usedSlots: 4,
    omittedEntries: 3,
    items: [s('Resin', 3)],
  },
];

/** The two fixtures as one scan (header from `containers-private.json`). */
export const CONTAINERS_DEMO_MESSAGE: ValheimContainersMessage = {
  schemaVersion: 1,
  serverId: 'srv_fixture_01',
  capturedAt: '2026-10-17T20:15:00Z',
  gameVersion: '0.220.5',
  modVersion: '1.0.0',
  kind: 'containers',
  worldUid: '1234567890123',
  containers: [...CONTAINERS_BASIC, ...CONTAINERS_PRIVATE],
  omittedShared: 1,
  omittedPrivate: 1,
};
