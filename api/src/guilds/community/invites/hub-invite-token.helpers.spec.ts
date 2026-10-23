/** ROK-1893 P1 — pure invite-link rules (token, state, expiry, revoke). */
import {
  canRevokeInvite,
  expiryFrom,
  generateHubInviteToken,
  inviteState,
  inviteUrl,
  isWellFormedHubInviteToken,
  managesInvites,
  type InviteStateFields,
  type InviteViewer,
} from './hub-invite-token.helpers';

const NOW = new Date('2026-10-22T12:00:00Z');
const live: InviteStateFields = {
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  revokedAt: null,
};
const viewer = (over: Partial<InviteViewer>): InviteViewer => ({
  userId: 5,
  role: 'member',
  staff: false,
  ...over,
});

describe('token (re-exported poll share token)', () => {
  it('mints well-formed, distinct tokens', () => {
    const [a, b] = [generateHubInviteToken(), generateHubInviteToken()];
    expect(isWellFormedHubInviteToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it.each(['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`, '../../etc'])(
    'rejects malformed %p',
    (t) => expect(isWellFormedHubInviteToken(t)).toBe(false),
  );
});

describe('inviteState', () => {
  it('ok for an open link', () => {
    expect(inviteState(live, NOW)).toBe('ok');
  });
  it('revoked wins over expired and exhausted', () => {
    const row = {
      revokedAt: NOW,
      expiresAt: new Date(NOW.getTime() - 1),
      maxUses: 1,
      useCount: 1,
    };
    expect(inviteState(row, NOW)).toBe('revoked');
  });
  it('expired at exactly expiresAt', () => {
    expect(inviteState({ ...live, expiresAt: NOW }, NOW)).toBe('expired');
  });
  it('exhausted when useCount reaches maxUses', () => {
    expect(inviteState({ ...live, maxUses: 2, useCount: 2 }, NOW)).toBe(
      'exhausted',
    );
    expect(inviteState({ ...live, maxUses: 2, useCount: 1 }, NOW)).toBe('ok');
  });
});

describe('expiryFrom', () => {
  it('defaults to 7 days', () => {
    expect(expiryFrom(undefined, NOW)?.toISOString()).toBe(
      '2026-10-29T12:00:00.000Z',
    );
  });
  it('null never expires', () => {
    expect(expiryFrom(null, NOW)).toBeNull();
  });
  it('honours explicit hours', () => {
    expect(expiryFrom(2, NOW)?.toISOString()).toBe('2026-10-22T14:00:00.000Z');
  });
});

describe('who manages / revokes', () => {
  it.each([
    ['leader', false, true],
    ['officer', false, true],
    ['member', false, false],
    ['member', true, true],
  ] as const)('%s staff=%s manages=%s', (role, staff, want) => {
    expect(managesInvites(viewer({ role, staff }))).toBe(want);
  });

  it('the maker revokes their own link; another member cannot', () => {
    expect(canRevokeInvite(viewer({}), 5)).toBe(true);
    expect(canRevokeInvite(viewer({}), 6)).toBe(false);
    expect(canRevokeInvite(viewer({}), null)).toBe(false);
    expect(canRevokeInvite(viewer({ role: 'officer' }), 6)).toBe(true);
  });
});

describe('inviteUrl', () => {
  it('builds /h/:token without a double slash', () => {
    expect(inviteUrl('https://rl.example/', 'tok')).toBe(
      'https://rl.example/h/tok',
    );
  });
});
