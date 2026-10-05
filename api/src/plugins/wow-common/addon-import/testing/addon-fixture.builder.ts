import { deflateSync } from 'node:zlib';
import type {
  AddonCharExport,
  AddonExportSection,
  AddonGuildExport,
  AddonGuildMember,
  AddonRaidExport,
  AddonWho,
} from '@raid-ledger/contract';

/**
 * Golden-fixture builder for the WoW: Forever addon import string
 * (ROK-1724). Mirrors the addon envelope exactly — `!RL<v>!<section>
 * [-<n>of<m>]!<standard base64 WITH padding of zlib(json)>`. When the real
 * ROK-1723 strings exist they drop into `testing/fixtures/*.txt`.
 */
export interface ImportStringOptions {
  section?: AddonExportSection;
  version?: number;
  page?: { n: number; of: number };
}

/** Wrap already-compressed bytes in the header (for bomb / corrupt cases). */
export function wrapImportBytes(
  compressed: Buffer,
  opts: ImportStringOptions = {},
): string {
  const section = opts.section ?? 'char';
  const paging = opts.page ? `-${opts.page.n}of${opts.page.of}` : '';
  return `!RL${opts.version ?? 1}!${section}${paging}!${compressed.toString('base64')}`;
}

/** Build an import string from a JSON-serialisable payload. */
export function buildImportString(
  payload: unknown,
  opts: ImportStringOptions = {},
): string {
  const section =
    opts.section ??
    (payload as { section?: AddonExportSection }).section ??
    'char';
  const compressed = deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  return wrapImportBytes(compressed, { ...opts, section });
}

export const FIXTURE_GUID = 'Player-4395-0ABCDEF0';
export const FIXTURE_EXPORTED_AT = 1_790_000_000;

export function buildWho(overrides: Partial<AddonWho> = {}): AddonWho {
  return {
    guid: FIXTURE_GUID,
    fullName: 'Ana Forever',
    raw: { getUnitName: 'Ana Forever', unitName: ['Ana Forever', null] },
    ruleset: 'normal',
    class: 'PALADIN',
    race: 'Human',
    level: 60,
    faction: 'Alliance',
    guildName: 'Night Shift',
    ...overrides,
  };
}

function envelope() {
  return {
    schema: 1 as const,
    addonVersion: '0.1.0',
    client: { interface: 11507, build: '1.15.7', locale: 'enUS', region: 1 },
    exportedAt: FIXTURE_EXPORTED_AT,
    who: buildWho(),
  };
}

export const FIXTURE_ITEM_LINK =
  '|cffa335ee|Hitem:19019:0:0:0:0:0:0:0:60:0:0:0:2:6646:7890|h[Thunderfury]|h|r';

export function buildCharPayload(
  overrides: Partial<AddonCharExport> = {},
): AddonCharExport {
  return {
    ...envelope(),
    section: 'char',
    data: {
      gear: [
        { slot: 16, link: FIXTURE_ITEM_LINK, ilvl: 80 },
        { slot: 1, itemId: 16921, ilvl: 76 },
      ],
      talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2 }] },
      lockouts: [
        {
          name: '|cffffd100Molten Core|r',
          instanceId: 409,
          difficultyId: 9,
          resetAt: 1_790_500_000,
          killed: 3,
          total: 10,
        },
      ],
    },
    ...overrides,
  };
}

export function buildMember(
  i: number,
  overrides: Partial<AddonGuildMember> = {},
): AddonGuildMember {
  const hex = i.toString(16).toUpperCase().padStart(8, '0');
  return {
    guid: `Player-4395-${hex}`,
    name: `Member${i}`,
    rankIndex: 3,
    rank: 'Raider',
    level: 60,
    class: 'MAGE',
    online: false,
    lastOnlineDays: 2,
    ...overrides,
  };
}

export function buildGuildPayload(
  members: AddonGuildMember[] = [buildMember(0xabcdef0)],
): AddonGuildExport {
  return {
    ...envelope(),
    section: 'guild',
    data: {
      name: 'Night Shift',
      snapshotAt: FIXTURE_EXPORTED_AT,
      canViewOfficerNote: false,
      members,
    },
  };
}

export function buildRaidPayload(): AddonRaidExport {
  return {
    ...envelope(),
    section: 'raid',
    data: {
      pulls: [
        {
          encounterId: 663,
          name: 'Lucifron',
          difficultyId: 9,
          groupSize: 40,
          instanceId: 409,
          startAt: 1_789_999_000,
          endAt: 1_789_999_120,
          success: true,
          roster: [FIXTURE_GUID],
          rosterNames: ['Ana Forever'],
        },
      ],
    },
  };
}

/** Split a guild payload's roster into `of` page strings (page order). */
export function buildGuildPages(
  payload: AddonGuildExport,
  of: number,
): string[] {
  const size = Math.ceil(payload.data.members.length / of);
  return Array.from({ length: of }, (_, i) =>
    buildImportString(
      {
        ...payload,
        data: {
          ...payload.data,
          members: payload.data.members.slice(i * size, (i + 1) * size),
        },
      },
      { section: 'guild', page: { n: i + 1, of } },
    ),
  );
}
