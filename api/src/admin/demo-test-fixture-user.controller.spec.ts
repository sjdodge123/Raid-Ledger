import {
  fixtureIdentity,
  parseFixtureSlot,
} from './demo-test-fixture-user.controller';

describe('seed-fixture-user slots (ROK-1454)', () => {
  it('slot 1 is the original stable identity every older smoke relies on', () => {
    expect(fixtureIdentity(1)).toEqual({
      discordId: 'smoke-invitee-fixture-001',
      username: 'smoke-invitee-fixture',
    });
  });

  it('higher slots are DISTINCT rows — a third hand must not be the second one', () => {
    const second = fixtureIdentity(2);
    expect(second).toEqual({
      discordId: 'smoke-invitee-fixture-002',
      username: 'smoke-invitee-fixture-2',
    });
    expect(second.discordId).not.toBe(fixtureIdentity(1).discordId);
    expect(second.username).not.toBe(fixtureIdentity(1).username);
  });

  it.each([
    ['no body', undefined, 1],
    ['empty body', {}, 1],
    ['slot 2', { slot: 2 }, 2],
    ['slot 9', { slot: 9 }, 9],
    ['slot 0', { slot: 0 }, 1],
    ['slot 10', { slot: 10 }, 1],
    ['a float', { slot: 2.5 }, 1],
    ['a string', { slot: '2' }, 1],
  ])('parses %s as slot %i', (_label, body, expected) => {
    expect(parseFixtureSlot(body)).toBe(expected);
  });
});
