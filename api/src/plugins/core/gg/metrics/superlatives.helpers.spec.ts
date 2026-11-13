import {
  pickSuperlative,
  type GgSuperlativeInputs,
} from './superlatives.helpers';

const none: GgSuperlativeInputs = {
  attended: 0,
  onTime: 0,
  created: 0,
  voiceSeconds: 0,
  sessions: 0,
  nightSessions: 0,
  newGames: 0,
};

describe('pickSuperlative', () => {
  it('falls back to welcome-aboard when no threshold is met', () => {
    expect(pickSuperlative({ ...none, attended: 4, created: 2 })).toEqual({
      key: 'welcome-aboard',
    });
  });

  it('awards always-on-time at 5+ attended with a 90%+ on-time ratio', () => {
    expect(pickSuperlative({ ...none, attended: 10, onTime: 9 })).toEqual({
      key: 'always-on-time',
      value: 0.9,
    });
    expect(pickSuperlative({ ...none, attended: 10, onTime: 8 }).key).toBe(
      'regular',
    );
  });

  it('awards the-planner at 3+ events created before the later keys', () => {
    expect(pickSuperlative({ ...none, created: 3, newGames: 9 })).toEqual({
      key: 'the-planner',
      value: 3,
    });
  });

  it('awards night-owl at 10+ sessions with 30%+ starting 00:00-04:00', () => {
    expect(
      pickSuperlative({ ...none, sessions: 10, nightSessions: 3 }),
    ).toEqual({ key: 'night-owl', value: 0.3 });
    expect(
      pickSuperlative({ ...none, sessions: 9, nightSessions: 9 }).key,
    ).toBe('welcome-aboard');
  });

  it('awards explorer, voice-regular and regular at their thresholds', () => {
    expect(pickSuperlative({ ...none, newGames: 5 })).toEqual({
      key: 'explorer',
      value: 5,
    });
    expect(pickSuperlative({ ...none, voiceSeconds: 36_000 })).toEqual({
      key: 'voice-regular',
      value: 36_000,
    });
    expect(pickSuperlative({ ...none, attended: 10 })).toEqual({
      key: 'regular',
      value: 10,
    });
  });
});
