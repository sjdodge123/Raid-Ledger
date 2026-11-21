import {
  signupLine,
  signupLineText,
  type SignupLineEmoji,
  type SignupLineState,
} from '../discord/hub-forum-discord-signup-lines';
import type { KeyedSignupLineMember } from '../discord/hub-forum-discord-signup-lines.queries';
import {
  planRlLines,
  SEED_MEMBER_KEY,
  userIdOfKey,
  type WrittenLineState,
} from './event-discussion-signup-lines';

const NO_GLYPHS: SignupLineEmoji = { role: () => '', klass: () => '' };

function state(over: Partial<SignupLineState> = {}): SignupLineState {
  return {
    status: 'signed_up',
    role: null,
    bench: false,
    character: null,
    late: false,
    lateMinutes: null,
    roachedHoursBefore: null,
    ...over,
  };
}

function member(
  key: string,
  name: string,
  over: Partial<SignupLineState> = {},
): KeyedSignupLineMember {
  const userId = userIdOfKey(key);
  return { memberKey: key, userId, displayName: name, state: state(over) };
}

const members = (...ms: KeyedSignupLineMember[]) =>
  new Map(ms.map((m) => [m.memberKey, m]));

function written(m: KeyedSignupLineMember): [string, WrittenLineState] {
  return [m.memberKey, { ...m.state, name: m.displayName }];
}

const prior = (...ms: KeyedSignupLineMember[]) => new Map(ms.map(written));

const plan = (
  p: Map<string, WrittenLineState> | null,
  m: Map<string, KeyedSignupLineMember>,
  resyncing = false,
) => planRlLines(p, m, NO_GLYPHS, resyncing);

const ANN = member('u:7', 'Ann');
const BOB = member('u:8', 'Bob', { status: 'tentative' });

describe('ROK-2274 planRlLines — seed', () => {
  it('first sight writes no line, seeds the marker and the ACTIVE members only', () => {
    const declined = member('u:9', 'Cy', { status: 'declined' });
    const out = plan(null, members(ANN, BOB, declined));
    expect(out.seed).toBe(true);
    expect(out.lines).toEqual([]);
    expect([...out.upsert.keys()]).toEqual([SEED_MEMBER_KEY, 'u:7', 'u:8']);
    expect(out.upsert.get('u:7')).toEqual({ ...ANN.state, name: 'Ann' });
  });

  it('a seeded thread with no change writes nothing', () => {
    const out = plan(prior(ANN, BOB), members(ANN, BOB));
    expect(out).toEqual({
      seed: false,
      lines: [],
      upsert: new Map(),
      drop: [],
    });
  });
});

describe('ROK-2274 planRlLines — lines', () => {
  it('a new signup gets one line naming them, and their state is written', () => {
    const out = plan(new Map(), members(ANN));
    expect(out.lines).toEqual([
      {
        memberKey: 'u:7',
        subjectUserId: 7,
        body: signupLineText(null, ANN.state, 'Ann', NO_GLYPHS),
      },
    ]);
    expect(out.lines[0]?.body).toContain('Ann');
    expect(out.upsert.get('u:7')?.name).toBe('Ann');
  });

  it('one line per changed member, never merged (Q2)', () => {
    const ann2 = member('u:7', 'Ann', { role: 'tank' });
    const bob2 = member('u:8', 'Bob', { status: 'signed_up' });
    const out = plan(prior(ANN, BOB), members(ann2, bob2));
    expect(out.lines.map((l) => l.memberKey)).toEqual(['u:7', 'u:8']);
    const again = plan(new Map(out.upsert), members(ANN, bob2));
    expect(again.lines.map((l) => l.memberKey)).toEqual(['u:7']);
  });

  it('a leaver is named from the written state; the state row is dropped', () => {
    const out = plan(prior(ANN), members());
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ memberKey: 'u:7', subjectUserId: 7 });
    expect(out.lines[0]?.body).toContain('Ann');
    expect(out.drop).toEqual(['u:7']);
    expect(out.upsert.has('u:7')).toBe(false);
  });

  it('leave then return reads as a fresh signup', () => {
    const gone = plan(prior(ANN), members());
    const back = plan(new Map(), members(ANN));
    expect(gone.drop).toEqual(['u:7']);
    expect(back.lines[0]?.body).toBe(
      signupLineText(null, ANN.state, 'Ann', NO_GLYPHS),
    );
  });

  it('a Discord guest is keyed d:<id> with no subject account', () => {
    const guest = member('d:123456789012345678', 'Pug');
    const out = plan(new Map(), members(guest));
    expect(out.lines[0]).toMatchObject({
      memberKey: 'd:123456789012345678',
      subjectUserId: null,
    });
  });
});

describe('ROK-2274 planRlLines — reset resync', () => {
  it('a reset moving tentative → signed_up is written silently', () => {
    const bob2 = member('u:8', 'Bob', { status: 'signed_up' });
    const out = plan(prior(BOB), members(bob2), true);
    expect(out.lines).toEqual([]);
    expect(out.upsert.get('u:8')?.status).toBe('signed_up');
  });

  it('without the flag the same move is a real line', () => {
    const bob2 = member('u:8', 'Bob', { status: 'signed_up' });
    expect(plan(prior(BOB), members(bob2)).lines).toHaveLength(1);
  });

  it('a real change during a resync still gets its line', () => {
    const ann2 = member('u:7', 'Ann', { role: 'healer' });
    const out = plan(prior(ANN), members(ann2), true);
    expect(out.lines.map((l) => l.memberKey)).toEqual(['u:7']);
  });
});

describe('ROK-2274 signupLineText — one vocabulary with the Discord line', () => {
  const tank = state({ role: 'tank' });
  const glyphs: SignupLineEmoji = { role: () => '🛡️', klass: () => '⚔️' };

  it('is the Discord line with the name in place of the mention', () => {
    const discord = signupLine(
      {
        discordId: '1',
        displayName: 'Ann',
        previous: state(),
        current: tank,
        mentioned: true,
      },
      glyphs,
    );
    expect(signupLineText(state(), tank, 'Ann', glyphs)).toBe(discord?.content);
  });

  it('keeps player text plain (no Discord markdown escaping)', () => {
    const ch = { name: 'Thr_all', className: 'Warrior', spec: null };
    const text = signupLineText(null, state({ character: ch }), 'A_b', glyphs);
    expect(text).toContain('Thr_all (Warrior)');
    expect(text).toContain('A_b');
  });
});

describe('ROK-2274 userIdOfKey', () => {
  it('reads an account key; a guest key has none', () => {
    expect(userIdOfKey('u:42')).toBe(42);
    expect(userIdOfKey('d:42')).toBeNull();
  });
});
