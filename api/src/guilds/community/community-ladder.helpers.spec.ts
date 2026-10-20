import {
  mayChangeStatus,
  mayModerate,
  viewerStateOf,
} from './community-ladder.helpers';

describe('community ladder (ROK-1870 D7)', () => {
  it('lets officers moderate members and non-members only', () => {
    expect(mayModerate('officer', 'member')).toBe(true);
    expect(mayModerate('officer', null)).toBe(true);
    expect(mayModerate('officer', 'officer')).toBe(false);
  });

  it('lets the leader moderate officers but nobody the leader', () => {
    expect(mayModerate('leader', 'officer')).toBe(true);
    expect(mayModerate('leader', 'member')).toBe(true);
    expect(mayModerate('leader', 'leader')).toBe(false);
  });

  it('refuses members and visitors', () => {
    expect(mayModerate('member', 'member')).toBe(false);
    expect(mayModerate('visitor', null)).toBe(false);
  });
});

describe('community status changes (ROK-1870 M14)', () => {
  it('lets a leader archive but not restore', () => {
    expect(mayChangeStatus(false, 'leader', 'archived')).toBe(true);
    expect(mayChangeStatus(false, 'leader', 'active')).toBe(false);
  });

  it('lets staff do either, and nobody else anything', () => {
    expect(mayChangeStatus(true, 'leader', 'active')).toBe(true);
    expect(mayChangeStatus(false, 'officer', 'archived')).toBe(false);
  });
});

describe('viewerStateOf', () => {
  it('maps a membership row to the directory viewer state', () => {
    expect(viewerStateOf(null)).toBe('not-member');
    expect(viewerStateOf({ role: 'officer', leftAt: null, bannedAt: null })).toBe('officer');
    expect(
      viewerStateOf({ role: 'member', leftAt: new Date(), bannedAt: null }),
    ).toBe('not-member');
    expect(
      viewerStateOf({ role: 'member', leftAt: new Date(), bannedAt: new Date() }),
    ).toBe('banned');
  });
});
