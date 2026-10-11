/**
 * ROK-1761: roster assignment characters carry race / ruleset / gameVariant,
 * and signup characters carry gameId / gameVariant / ruleset, so the web can
 * draw the WoW: Forever fallback portrait from the CHARACTER's own game. One
 * copy of each builder lives in signups-roster.helpers; both roster-assignment
 * builders must route through it.
 */
import type * as schema from '../drizzle/schema';
import { buildRosterAssignmentResponse } from './signup-response.helpers';
import {
  buildCharacterDto,
  buildRosterAssignmentResponseDto,
  buildRosterCharacter,
} from './signups-roster.helpers';

type CharacterRow = typeof schema.characters.$inferSelect;
type SignupRow = typeof schema.eventSignups.$inferSelect;

const signup = {
  id: 7,
  eventId: 1,
  userId: 1,
  status: 'signed_up',
  preferredRoles: null,
  runningLateAt: null,
  lateMinutes: null,
  discordUserId: null,
} as SignupRow;

const forever = {
  id: '17610000-0000-4000-8000-00000000000a',
  name: 'Fernwhisper',
  class: 'Druid',
  role: 'healer',
  roleOverride: null,
  avatarUrl: null,
  race: 'Night Elf',
  ruleset: 'normal',
  gameVariant: null,
  gameId: 7,
  isMain: true,
  spec: null,
  itemLevel: null,
  level: 25,
  faction: 'alliance',
  professions: null,
} as CharacterRow;

const nonWow = {
  ...forever,
  id: '17610000-0000-4000-8000-0000000000ff',
  name: 'Sova',
  class: null,
  race: null,
  ruleset: null,
  gameVariant: null,
  gameId: 42,
} as CharacterRow;

describe('buildRosterCharacter — Forever portrait fields (ROK-1761)', () => {
  it('a Forever character carries race, ruleset and gameVariant', () => {
    expect(buildRosterCharacter(forever)).toEqual(
      expect.objectContaining({
        name: 'Fernwhisper',
        className: 'Druid',
        race: 'Night Elf',
        ruleset: 'normal',
        gameVariant: null,
      }),
    );
  });

  it('a non-WoW character carries nulls', () => {
    expect(buildRosterCharacter(nonWow)).toEqual(
      expect.objectContaining({ race: null, ruleset: null, gameVariant: null }),
    );
  });

  it('no character stays null', () => {
    expect(buildRosterCharacter(null)).toBeNull();
  });
});

describe.each([
  ['buildRosterAssignmentResponse', buildRosterAssignmentResponse],
  ['buildRosterAssignmentResponseDto', buildRosterAssignmentResponseDto],
] as const)('%s — routes through buildRosterCharacter (ROK-1761)', (_n, build) => {
  it('the assignment character equals the shared builder output', () => {
    const res = build({ event_signups: signup, users: null, characters: forever });
    expect(res.character).toEqual(buildRosterCharacter(forever));
  });

  it('no character stays null', () => {
    const res = build({ event_signups: signup, users: null, characters: null });
    expect(res.character).toBeNull();
  });
});

describe('buildCharacterDto — the character’s own game (ROK-1761)', () => {
  it('carries gameId, gameVariant and ruleset from the character row', () => {
    expect(buildCharacterDto(forever)).toEqual(
      expect.objectContaining({ gameId: 7, gameVariant: null, ruleset: 'normal' }),
    );
    expect(buildCharacterDto(nonWow)).toEqual(
      expect.objectContaining({ gameId: 42, gameVariant: null, ruleset: null }),
    );
  });
});
