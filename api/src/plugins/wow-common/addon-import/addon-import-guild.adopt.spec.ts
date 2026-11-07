/**
 * ROK-1928 §B3 — the pure half of GUID adoption. The DB half (Blizzard row
 * then addon import → one row) is proven in
 * `guilds/blizzard-roster-sync.integration.spec.ts` scenario 4.
 */
import { pickAdoptions, type AdoptableRow } from './addon-import-guild.adopt';

const row = (
  id: number,
  name: string,
  guid: string | null = null,
  seen = 0,
): AdoptableRow => ({
  id,
  guid,
  characterName: name,
  lastSeenAt: new Date(1_790_000_000_000 + seen),
});

describe('pickAdoptions', () => {
  it('a new GUID adopts the GUID-less row of the same name, case-insensitively', () => {
    const rows = [row(1, 'Ana'), row(2, 'Bob', 'Player-1')];
    expect(pickAdoptions(rows, [{ guid: 'Player-9', name: 'ANA' }])).toEqual([
      { id: 1, guid: 'Player-9' },
    ]);
  });

  it('a GUID the guild already stores adopts nothing', () => {
    const rows = [row(1, 'Ana'), row(2, 'Ana', 'Player-9')];
    expect(pickAdoptions(rows, [{ guid: 'Player-9', name: 'Ana' }])).toEqual(
      [],
    );
  });

  it('rows that already carry a GUID are never adopted', () => {
    const rows = [row(2, 'Ana', 'Player-1')];
    expect(pickAdoptions(rows, [{ guid: 'Player-9', name: 'Ana' }])).toEqual(
      [],
    );
  });

  it('two same-name rows: the newest adopts first, each row at most once', () => {
    const rows = [row(1, 'Ana', null, 0), row(2, 'Ana', null, 5)];
    const members = [
      { guid: 'Player-8', name: 'Ana' },
      { guid: 'Player-9', name: 'Ana' },
      { guid: 'Player-7', name: 'Ana' },
    ];
    expect(pickAdoptions(rows, members)).toEqual([
      { id: 2, guid: 'Player-8' },
      { id: 1, guid: 'Player-9' },
    ]);
  });
});
