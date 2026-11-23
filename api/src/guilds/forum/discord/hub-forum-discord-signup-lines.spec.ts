/**
 * ROK-2271 — signup line diff + wording. One line per member per flush,
 * null when nothing changed, `<@id>` only while not yet mentioned.
 */
import {
  characterLabel,
  hoursLabel,
  signupLine as buildLine,
  signupLines as buildLines,
  type SignupLineEmoji,
  type SignupLineInput,
  type SignupLineState,
} from './hub-forum-discord-signup-lines';

/**
 * ROK-2273: a guild with no role/class glyphs — the wording under test
 * here; the glyphs are `hub-forum-discord-signup-lines.emoji.spec.ts`.
 */
const NONE: SignupLineEmoji = { role: () => '', klass: () => '' };
const signupLine = (i: SignupLineInput) => buildLine(i, NONE);
const signupLines = (is: readonly SignupLineInput[]) => buildLines(is, NONE);

const ID = '111111111111111111';
const THRALL = { name: 'Thrall', className: 'Warrior', spec: 'Prot' };
const JAINA = { name: 'Jaina', className: 'Mage', spec: null };

function state(over: Partial<SignupLineState> = {}): SignupLineState {
  return {
    status: 'signed_up',
    role: 'tank',
    bench: false,
    character: THRALL,
    late: false,
    lateMinutes: null,
    roachedHoursBefore: null,
    ...over,
  };
}

function input(
  previous: SignupLineState | null,
  current: SignupLineState | null,
  mentioned = true,
): SignupLineInput {
  return { discordId: ID, displayName: 'Bob', previous, current, mentioned };
}

/** The posted text, or null — fails loudly on a mismatch either way. */
const text = (i: SignupLineInput) => signupLine(i)?.content ?? null;

describe('signupLine — first signup', () => {
  it('mentions the member with role and character', () => {
    expect(signupLine(input(null, state(), false))).toEqual({
      discordId: ID,
      content: `✅ <@${ID}> signed up — Tank · Thrall (Prot Warrior)`,
      mention: true,
    });
  });

  it('says tentative for a tentative signup', () => {
    expect(text(input(null, state({ status: 'tentative' }), false))).toBe(
      `⏳ <@${ID}> is tentative — Tank · Thrall (Prot Warrior)`,
    );
  });

  it('shows Bench in place of a role', () => {
    expect(text(input(null, state({ bench: true, role: null }), false))).toBe(
      `✅ <@${ID}> signed up — Bench · Thrall (Prot Warrior)`,
    );
  });

  it('omits the detail when neither role nor character is known', () => {
    const bare = state({ role: null, character: null });
    expect(text(input(null, bare, false))).toBe(`✅ <@${ID}> signed up`);
  });

  it('names an unknown role id as-is and a classless character bare', () => {
    const s = state({
      role: 'support',
      character: { ...JAINA, className: null },
    });
    expect(text(input(null, s, false))).toBe(
      `✅ <@${ID}> signed up — support · Jaina`,
    );
  });

  it('does not ping a member who is already mentioned', () => {
    const line = signupLine(input(null, state(), true));
    expect(line?.mention).toBe(false);
    expect(line?.content).toBe(
      '✅ Bob signed up — Tank · Thrall (Prot Warrior)',
    );
  });
});

describe('Codex P2-2 — late before the first line', () => {
  it('a first signup already running late announces both', () => {
    const now = state({ late: true, lateMinutes: 15 });
    expect(text(input(null, now, false))).toBe(
      `✅ <@${ID}> signed up · is running late (~15 min) — Tank · Thrall (Prot Warrior)`,
    );
  });

  it('a return already running late announces both', () => {
    const was = state({ status: 'declined', late: true });
    expect(text(input(was, state({ late: true }), true))).toBe(
      '↩️ Bob is back · is running late — Tank · Thrall (Prot Warrior)',
    );
  });
});

describe('signupLine — coming back', () => {
  it('says "is back" after a decline and mentions again once cleared', () => {
    const was = state({ status: 'declined' });
    expect(text(input(was, state(), false))).toBe(
      `↩️ <@${ID}> is back — Tank · Thrall (Prot Warrior)`,
    );
  });

  it('says "is back (tentative)" for a tentative return', () => {
    const was = state({ status: 'roached_out' });
    expect(text(input(was, state({ status: 'tentative' }), true))).toBe(
      '⏳ Bob is back (tentative) — Tank · Thrall (Prot Warrior)',
    );
  });
});

describe('signupLine — changes while signed up (no ping)', () => {
  it('posts nothing when nothing changed', () => {
    expect(signupLine(input(state(), state()))).toBeNull();
  });

  it('posts nothing when only an unrendered field differs', () => {
    const now = state({ lateMinutes: 10 });
    expect(signupLine(input(state(), now))).toBeNull();
  });

  it('tentative → confirmed', () => {
    const was = state({ status: 'tentative' });
    expect(text(input(was, state()))).toBe(
      '✅ Bob is confirmed (was tentative)',
    );
  });

  it('confirmed → tentative', () => {
    expect(text(input(state(), state({ status: 'tentative' })))).toBe(
      '⏳ Bob is now tentative',
    );
  });
});

describe('signupLine — roster and character changes (no ping)', () => {
  it('role change', () => {
    expect(text(input(state(), state({ role: 'healer' })))).toBe(
      '🔁 Bob Tank → Healer',
    );
  });

  it('role assigned from none', () => {
    expect(text(input(state({ role: null }), state({ role: 'dps' })))).toBe(
      '🔁 Bob no role → DPS',
    );
  });

  it('character change', () => {
    expect(text(input(state(), state({ character: JAINA })))).toBe(
      '🔁 Bob now on Jaina (Mage)',
    );
  });

  it('character dropped posts nothing', () => {
    expect(signupLine(input(state(), state({ character: null })))).toBeNull();
  });

  it('benched', () => {
    expect(text(input(state(), state({ bench: true, role: null })))).toBe(
      '🪑 Bob benched',
    );
  });

  it('promoted from bench into a role', () => {
    const was = state({ bench: true, role: null });
    expect(text(input(was, state({ role: 'healer' })))).toBe(
      '⬆️ Bob promoted from bench → Healer',
    );
  });

  it('promoted from bench without a role', () => {
    const was = state({ bench: true, role: null });
    expect(text(input(was, state({ role: null })))).toBe(
      '⬆️ Bob promoted from bench',
    );
  });

  it('combines several changes into ONE line, first emoji leads', () => {
    const was = state({ status: 'tentative' });
    const now = state({ role: 'healer', character: JAINA });
    expect(text(input(was, now))).toBe(
      '✅ Bob is confirmed (was tentative) · Tank → Healer · now on Jaina (Mage)',
    );
  });

  it('pings a member on a change line when they were never mentioned', () => {
    const line = signupLine(input(state(), state({ role: 'dps' }), false));
    expect(line?.content).toBe(`🔁 <@${ID}> Tank → DPS`);
    expect(line?.mention).toBe(true);
  });
});

describe('signupLine — running late', () => {
  it('running late with minutes', () => {
    const now = state({ late: true, lateMinutes: 15 });
    expect(text(input(state(), now))).toBe('⏰ Bob is running late (~15 min)');
  });

  it('running late without minutes', () => {
    expect(text(input(state(), state({ late: true })))).toBe(
      '⏰ Bob is running late',
    );
  });

  it('back on time', () => {
    const was = state({ late: true, lateMinutes: 15 });
    expect(text(input(was, state()))).toBe('👍 Bob is on time again');
  });

  it('still late posts nothing', () => {
    const late = state({ late: true, lateMinutes: 15 });
    expect(signupLine(input(late, late))).toBeNull();
  });
});

describe('signupLine — leaving (never pings)', () => {
  it('decline', () => {
    const line = signupLine(
      input(state(), state({ status: 'declined' }), false),
    );
    expect(line).toEqual({
      discordId: ID,
      content: '👋 Bob declined',
      mention: false,
    });
  });

  it('row gone (current null)', () => {
    expect(text(input(state(), null))).toBe('👋 Bob declined');
  });

  it('departed', () => {
    expect(text(input(state(), state({ status: 'departed' })))).toBe(
      '👋 Bob left the event',
    );
  });

  it('roach-out with hours before start', () => {
    const now = state({ status: 'roached_out', roachedHoursBefore: 3.2 });
    expect(text(input(state(), now))).toBe(
      '🪳 Bob roached out (3 h before start)',
    );
  });

  it('roach-out under an hour', () => {
    const now = state({ status: 'roached_out', roachedHoursBefore: 0.4 });
    expect(text(input(state(), now))).toBe(
      '🪳 Bob roached out (<1 h before start)',
    );
  });

  it('roach-out with unknown timing', () => {
    expect(text(input(state(), state({ status: 'roached_out' })))).toBe(
      '🪳 Bob roached out',
    );
  });

  it('posts nothing for someone never posted who is not active', () => {
    expect(
      signupLine(input(null, state({ status: 'declined' }), false)),
    ).toBeNull();
    expect(signupLine(input(null, null, false))).toBeNull();
  });

  it('posts nothing for an already-announced leaver', () => {
    const gone = state({ status: 'declined' });
    expect(signupLine(input(gone, null))).toBeNull();
  });
});

describe('signupLines + labels', () => {
  it('drops unchanged members and keeps input order', () => {
    const lines = signupLines([
      { ...input(state(), state()), discordId: '1' },
      { ...input(null, state(), false), discordId: '2' },
      { ...input(state(), state({ late: true })), discordId: '3' },
    ]);
    expect(lines.map((l) => [l.discordId, l.mention])).toEqual([
      ['2', true],
      ['3', false],
    ]);
  });

  it('labels', () => {
    expect(characterLabel({ name: 'A', className: null, spec: 'Holy' })).toBe(
      'A (Holy)',
    );
    expect(hoursLabel(0.99)).toBe('<1');
    expect(hoursLabel(2.6)).toBe('3');
  });
});

/** A markdown control character with no backslash before it. */
const UNESCAPED = /(?<!\\)[*_~|`]/;

describe('review MINOR-3 — names are text, never formatting', () => {
  it('escapes markdown in a display name', () => {
    const name = '**ADMIN** ~~x~~ ||s|| `c` _i_';
    const line = signupLine({
      ...input(state(), state({ status: 'declined' })),
      displayName: name,
    });
    expect(line?.content).toMatch(/^👋 .+ declined$/);
    expect(line?.content).not.toMatch(UNESCAPED);
  });

  it('escapes markdown in a character label', () => {
    const label = characterLabel({
      name: '*Thr_all*',
      className: 'War`rior',
      spec: '~~Prot~~',
    });
    expect(label).not.toMatch(UNESCAPED);
  });

  it('an @everyone name stays plain text and pings nobody', () => {
    const line = signupLine({
      ...input(state(), state({ status: 'declined' })),
      displayName: '@everyone',
    });
    expect(line).toEqual({
      discordId: ID,
      content: '👋 @everyone declined',
      mention: false,
    });
  });
});
