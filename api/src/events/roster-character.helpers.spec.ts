/**
 * ROK-1761: roster assignment characters carry race / ruleset / gameVariant so
 * the web can draw the WoW: Forever fallback portrait. Both roster builders
 * (assignments read + roster query) must fill them from the characters row.
 */
import type * as schema from '../drizzle/schema';
import { buildRosterAssignmentResponse } from './signup-response.helpers';
import { buildRosterAssignmentResponseDto } from './signups-roster.helpers';

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
} as CharacterRow;

const nonWow = {
  ...forever,
  id: '17610000-0000-4000-8000-0000000000ff',
  name: 'Sova',
  class: null,
  race: null,
  ruleset: null,
  gameVariant: null,
} as CharacterRow;

const builders = [
  ['buildRosterAssignmentResponse', buildRosterAssignmentResponse],
  ['buildRosterAssignmentResponseDto', buildRosterAssignmentResponseDto],
] as const;

describe.each(builders)(
  '%s — Forever portrait fields (ROK-1761)',
  (_name, build) => {
    it('a Forever character carries race, ruleset and gameVariant', () => {
      const res = build({
        event_signups: signup,
        users: null,
        characters: forever,
      });
      expect(res.character).toEqual(
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
      const res = build({
        event_signups: signup,
        users: null,
        characters: nonWow,
      });
      expect(res.character).toEqual(
        expect.objectContaining({
          race: null,
          ruleset: null,
          gameVariant: null,
        }),
      );
    });

    it('no character stays null', () => {
      expect(
        build({ event_signups: signup, users: null, characters: null })
          .character,
      ).toBeNull();
    });
  },
);
