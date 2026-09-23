/**
 * The boot seed's game registry (api/scripts/seed-games.ts).
 *
 * Lives under src/ (ROK-1643) so the API can read the seed-owned slug list at
 * runtime: IGDB/ITAD enrichment must never rename a game the seed defines
 * (see seed-owned-games.helpers.ts). The seed script imports this list, so
 * adding a game here both seeds it and locks its curated name.
 */
import { WOW_FOREVER_NAMESPACE_PREFIX } from '../plugins/wow-common/blizzard.constants';

/** Seed data for the game registry, upserted by slug on every boot. */
export const GAMES_SEED = [
  {
    igdbId: 123,
    slug: 'world-of-warcraft',
    name: 'World of Warcraft',
    shortName: 'WoW',
    iconUrl: null,
    colorHex: '#F58518',
    hasRoles: true,
    hasSpecs: true,
    apiNamespacePrefix: null,
    maxCharactersPerUser: 10,
    eventTypes: [
      {
        slug: 'mythic-raid',
        name: 'Mythic Raid',
        defaultPlayerCap: 20,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'heroic-raid',
        name: 'Heroic Raid',
        defaultPlayerCap: 30,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'normal-raid',
        name: 'Normal Raid',
        defaultPlayerCap: 30,
        defaultDurationMinutes: 150,
        requiresComposition: true,
      },
      {
        slug: 'mythic-plus',
        name: 'Mythic+ Dungeon',
        defaultPlayerCap: 5,
        defaultDurationMinutes: 60,
        requiresComposition: true,
      },
      {
        slug: 'delve',
        name: 'Delve',
        defaultPlayerCap: 5,
        defaultDurationMinutes: 30,
        requiresComposition: false,
      },
    ],
  },
  {
    igdbId: 75379,
    slug: 'world-of-warcraft-classic',
    name: 'World of Warcraft Classic Era',
    shortName: 'WoW Classic Era',
    iconUrl: null,
    colorHex: '#C79C6E',
    hasRoles: true,
    hasSpecs: true,
    apiNamespacePrefix: 'classic1x',
    maxCharactersPerUser: 10,
    eventTypes: [
      {
        slug: 'classic-40-raid',
        name: '40-Man Raid',
        defaultPlayerCap: 40,
        defaultDurationMinutes: 240,
        requiresComposition: true,
      },
      {
        slug: 'classic-25-raid',
        name: '25-Man Raid',
        defaultPlayerCap: 25,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'classic-10-raid',
        name: '10-Man Raid',
        defaultPlayerCap: 10,
        defaultDurationMinutes: 120,
        requiresComposition: true,
      },
      {
        slug: 'classic-dungeon',
        name: 'Dungeon',
        defaultPlayerCap: 5,
        defaultDurationMinutes: 60,
        requiresComposition: true,
      },
    ],
  },
  {
    igdbId: null,
    slug: 'world-of-warcraft-burning-crusade-classic-anniversary-edition',
    name: 'World of Warcraft: Burning Crusade Classic - Anniversary Edition',
    shortName: 'WoW TBC Anniversary',
    iconUrl: null,
    colorHex: '#C79C6E',
    hasRoles: true,
    hasSpecs: true,
    apiNamespacePrefix: 'classicann',
    maxCharactersPerUser: 10,
    eventTypes: [
      {
        slug: 'classic-25-raid',
        name: '25-Man Raid',
        defaultPlayerCap: 25,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'classic-10-raid',
        name: '10-Man Raid',
        defaultPlayerCap: 10,
        defaultDurationMinutes: 120,
        requiresComposition: true,
      },
      {
        slug: 'classic-dungeon',
        name: 'Dungeon',
        defaultPlayerCap: 5,
        defaultDurationMinutes: 90,
        requiresComposition: true,
      },
    ],
  },
  {
    // ROK-1563: WoW: Forever (launch 2026-11-04). No IGDB id yet — same
    // precedent as the Anniversary row above; the normalized-name guard merges
    // the IGDB row in when the sync finds it. The namespace prefix is the
    // placeholder ROK-1562's probe replaces; a wrong prefix 404s loudly.
    igdbId: null,
    slug: 'world-of-warcraft-forever',
    name: 'World of Warcraft: Forever',
    shortName: 'WoW Forever',
    iconUrl: null,
    colorHex: '#C79C6E',
    hasRoles: true,
    hasSpecs: true,
    apiNamespacePrefix: WOW_FOREVER_NAMESPACE_PREFIX,
    maxCharactersPerUser: 10,
    eventTypes: [
      {
        slug: 'classic-40-raid',
        name: '40-Man Raid',
        defaultPlayerCap: 40,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'classic-20-raid',
        name: '20-Man Raid',
        defaultPlayerCap: 20,
        defaultDurationMinutes: 150,
        requiresComposition: true,
      },
      {
        slug: 'classic-dungeon',
        name: 'Dungeon',
        defaultPlayerCap: 5,
        defaultDurationMinutes: 90,
        requiresComposition: true,
      },
    ],
  },
  {
    igdbId: 104967,
    slug: 'valheim',
    name: 'Valheim',
    shortName: null,
    iconUrl: null,
    colorHex: '#4A7C59',
    hasRoles: false,
    hasSpecs: false,
    maxCharactersPerUser: 5,
    eventTypes: [
      {
        slug: 'boss-raid',
        name: 'Boss Raid',
        defaultPlayerCap: 10,
        defaultDurationMinutes: 120,
        requiresComposition: false,
      },
      {
        slug: 'exploration',
        name: 'Exploration',
        defaultPlayerCap: 10,
        defaultDurationMinutes: 120,
        requiresComposition: false,
      },
      {
        slug: 'building',
        name: 'Building Session',
        defaultPlayerCap: 10,
        defaultDurationMinutes: 180,
        requiresComposition: false,
      },
    ],
  },
  {
    igdbId: 14729,
    slug: 'final-fantasy-xiv-online',
    name: 'Final Fantasy XIV Online',
    shortName: 'FFXIV',
    iconUrl: null,
    colorHex: '#5D5CDE',
    hasRoles: true,
    hasSpecs: true,
    maxCharactersPerUser: 8,
    eventTypes: [
      {
        slug: 'savage-raid',
        name: 'Savage Raid',
        defaultPlayerCap: 8,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      },
      {
        slug: 'extreme-trial',
        name: 'Extreme Trial',
        defaultPlayerCap: 8,
        defaultDurationMinutes: 60,
        requiresComposition: true,
      },
      {
        slug: 'alliance-raid',
        name: 'Alliance Raid',
        defaultPlayerCap: 24,
        defaultDurationMinutes: 120,
        requiresComposition: false,
      },
    ],
  },
  {
    slug: 'generic',
    name: 'Generic',
    shortName: null,
    iconUrl: null,
    colorHex: '#6B7280',
    hasRoles: false,
    hasSpecs: false,
    maxCharactersPerUser: 1,
    eventTypes: [
      {
        slug: 'custom-event',
        name: 'Custom Event',
        defaultPlayerCap: null,
        defaultDurationMinutes: 120,
        requiresComposition: false,
      },
    ],
  },
  {
    // ROK-1377: operator's own game — free, browser-based, not on Steam.
    // ROK-1410: cover is self-hosted (web/public/game-covers/) — the original
    // chaochaogame.com favicon URL was blocked by the CSP img-src allowlist.
    slug: 'chao-chao',
    name: 'Chao Chao',
    shortName: null,
    iconUrl: null,
    coverUrl: '/game-covers/chao-chao-cover.jpg',
    colorHex: '#D4A017',
    hasRoles: false,
    hasSpecs: false,
    maxCharactersPerUser: 1,
    websiteUrl: 'https://chaochaogame.com',
    isFreeToPlay: true,
    eventTypes: [
      {
        slug: 'race-night',
        name: 'Race Night',
        defaultPlayerCap: null,
        defaultDurationMinutes: 60,
        requiresComposition: false,
      },
    ],
  },
];
