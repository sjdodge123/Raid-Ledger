/**
 * ROK-1756: mapCharacterToDto exposes only whether a character is linked to
 * the WoW addon (`addonLinked`) — never the GUID itself.
 */
import type * as schema from '../drizzle/schema';
import { mapCharacterToDto } from './characters-mapping.helpers';

type CharacterRow = typeof schema.characters.$inferSelect;

function makeRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 1,
    gameId: 1,
    name: 'Ana',
    realm: null,
    class: null,
    spec: null,
    role: null,
    roleOverride: null,
    isMain: false,
    itemLevel: null,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: null,
    race: null,
    gender: null,
    faction: null,
    lastSyncedAt: null,
    profileUrl: null,
    region: null,
    ruleset: null,
    addonGuid: null,
    gameVariant: null,
    equipment: null,
    talents: null,
    professions: null,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('mapCharacterToDto addonLinked (ROK-1756)', () => {
  it('is true when the row has an addon GUID, without exposing it', () => {
    const dto = mapCharacterToDto(
      makeRow({ addonGuid: 'Player-1234-0ABCDEF1' }),
    );
    expect(dto.addonLinked).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('Player-1234-0ABCDEF1');
  });

  it('is false when the addon GUID is null', () => {
    expect(mapCharacterToDto(makeRow({ addonGuid: null })).addonLinked).toBe(
      false,
    );
  });
});
