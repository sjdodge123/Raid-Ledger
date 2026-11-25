/**
 * ROK-2370 — pure helpers for `/login code:` (copy, button id, attempt limit).
 */
import { ButtonStyle } from 'discord.js';
import {
  SIGNIN_CODE_APPROVE_LABEL,
  SIGNIN_CODE_ATTEMPT_MAX,
  SIGNIN_CODE_INVALID_COPY,
  approveSigninCode,
  buildSigninCodeConfirmRow,
  checkSigninCodeAttempts,
  parseSigninCodeApproveId,
  replyToSigninCode,
  signinCodeApproveId,
  signinCodeAttemptKey,
  signinCodeConfirmCopy,
  signinCodeDoneCopy,
  type SigninCodeDeps,
  type SigninCodeReply,
  type SigninCodeReplyTarget,
} from './login-code.helpers';

/** In-memory INCR/EXPIRE/TTL with a settable clock-free TTL. */
function fakeRedis(): {
  incr: jest.Mock;
  expire: jest.Mock;
  ttl: jest.Mock;
  keys: Map<string, number>;
} {
  const keys = new Map<string, number>();
  return {
    keys,
    incr: jest.fn((key: string) => {
      const next = (keys.get(key) ?? 0) + 1;
      keys.set(key, next);
      return Promise.resolve(next);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl: jest.fn(() => Promise.resolve(540)),
  };
}

const BROWSER_NAMES = /safari|chrome|firefox|edge|ios|android|iphone/i;

describe('signin-code button id', () => {
  it('round-trips a code through the custom id', () => {
    const id = signinCodeApproveId('K7QD-2M9X');
    expect(id).toBe('signin-code:approve:K7QD-2M9X');
    expect(parseSigninCodeApproveId(id)).toBe('K7QD-2M9X');
  });

  it('ignores other buttons and malformed codes', () => {
    expect(parseSigninCodeApproveId('ai:menu')).toBeNull();
    expect(parseSigninCodeApproveId('signin-code:approve:NOPE')).toBeNull();
  });
});

describe('signin-code copy', () => {
  it('names the code and the account, with the phishing warning', () => {
    const copy = signinCodeConfirmCopy('K7QD-2M9X', 'Roknua');
    expect(copy).toBe(
      'Sign in the browser showing code **K7QD-2M9X** as **Roknua**? ' +
        'Only continue if you started this yourself, just now.',
    );
  });

  it('done and invalid copy use generic browser wording', () => {
    const done = signinCodeDoneCopy('Roknua');
    expect(done).toBe(
      "Done — go back to your browser. You're signed in as Roknua.",
    );
    expect(SIGNIN_CODE_INVALID_COPY).toBe(
      "That code isn't valid or has expired. Start again on the sign-in page.",
    );
    const all = [done, SIGNIN_CODE_INVALID_COPY];
    all.push(signinCodeConfirmCopy('K7QD-2M9X', 'x'));
    for (const text of all) expect(text).not.toMatch(BROWSER_NAMES);
  });

  it('the confirm row has one primary "Yes, sign me in" button carrying the code', () => {
    const json = buildSigninCodeConfirmRow('K7QD-2M9X').toJSON();
    expect(json.components).toHaveLength(1);
    expect(json.components[0]).toMatchObject({
      style: ButtonStyle.Primary,
      label: SIGNIN_CODE_APPROVE_LABEL,
      custom_id: 'signin-code:approve:K7QD-2M9X',
    });
  });
});

describe('checkSigninCodeAttempts', () => {
  it('allows 5 attempts per member and refuses the 6th with the minutes left', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < SIGNIN_CODE_ATTEMPT_MAX; i += 1) {
      expect(await checkSigninCodeAttempts(redis, '42')).toEqual({
        allowed: true,
      });
    }
    expect(await checkSigninCodeAttempts(redis, '42')).toEqual({
      allowed: false,
      retryMinutes: 9,
    });
    expect(SIGNIN_CODE_ATTEMPT_MAX).toBe(5);
    expect(redis.keys.get(signinCodeAttemptKey('42'))).toBe(6);
    expect(redis.expire).toHaveBeenCalledWith('signin-code:rl:42', 600);
  });

  it('counts each member separately', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < SIGNIN_CODE_ATTEMPT_MAX; i += 1) {
      await checkSigninCodeAttempts(redis, '1');
    }
    expect(await checkSigninCodeAttempts(redis, '2')).toEqual({
      allowed: true,
    });
  });
});

describe('signin-code flows', () => {
  const user = { id: '77', username: 'disc-user', avatar: null };
  const pending = { code: 'K7QD-2M9X', expiresAt: new Date() };
  const grant = { kind: 'existing', userId: 9, clientUrl: 'https://x' } as const;

  function deps(over: Partial<SigninCodeDeps> = {}): SigninCodeDeps & {
    store: { findPending: jest.Mock; approve: jest.Mock };
  } {
    return {
      redis: fakeRedis(),
      store: {
        findPending: jest.fn().mockResolvedValue(pending),
        approve: jest.fn().mockResolvedValue(true),
      },
      decide: jest.fn().mockResolvedValue({
        decision: grant,
        communityName: null,
        displayName: 'Roknua',
      }),
      mint: jest.fn().mockResolvedValue({
        kind: 'existing',
        token: 't',
        displayName: 'Roknua',
      }),
      ...over,
    } as never;
  }

  function target(): SigninCodeReplyTarget & { editReply: jest.Mock } {
    return { user, editReply: jest.fn().mockResolvedValue(undefined) };
  }

  it('a valid typed code (lower case, no dash) gets the confirm card', async () => {
    const t = target();
    const d = deps();
    await replyToSigninCode(t, 'k7qd2m9x', d);
    expect(d.store.findPending).toHaveBeenCalledWith('K7QD-2M9X');
    const [[reply]] = t.editReply.mock.calls as [[SigninCodeReply]];
    expect(reply.content).toBe(signinCodeConfirmCopy('K7QD-2M9X', 'Roknua'));
    expect(reply.components).toHaveLength(1);
  });

  it('an unknown code gets the invalid copy and no button', async () => {
    const t = target();
    const d = deps();
    d.store.findPending.mockResolvedValue(null);
    await replyToSigninCode(t, 'ZZZZ-ZZZZ', d);
    expect(t.editReply).toHaveBeenCalledWith({
      content: SIGNIN_CODE_INVALID_COPY,
      components: [],
    });
  });

  it('a refused clicker gets the /login refusal and the code is NOT approved', async () => {
    const t = target();
    const d = deps({
      decide: jest.fn().mockResolvedValue({
        decision: { kind: 'deactivated' },
        communityName: null,
        displayName: 'x',
      }),
    });
    expect(await approveSigninCode(t, 'K7QD-2M9X', d)).toBeNull();
    expect(d.store.approve).not.toHaveBeenCalled();
    expect(t.editReply).toHaveBeenCalledWith({
      content:
        'Your account is inactive — rejoin the Discord server, then try again.',
      components: [],
    });
  });

  it('approves once and shows the done copy; a lost race shows the invalid copy', async () => {
    const t = target();
    const d = deps();
    expect(await approveSigninCode(t, 'K7QD-2M9X', d)).not.toBeNull();
    expect(t.editReply).toHaveBeenLastCalledWith({
      content: signinCodeDoneCopy('Roknua'),
      components: [],
    });
    d.store.approve.mockResolvedValue(false);
    expect(await approveSigninCode(t, 'K7QD-2M9X', d)).toBeNull();
    expect(t.editReply).toHaveBeenLastCalledWith({
      content: SIGNIN_CODE_INVALID_COPY,
      components: [],
    });
  });
});
