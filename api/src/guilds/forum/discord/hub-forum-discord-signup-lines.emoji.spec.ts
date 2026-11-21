/**
 * ROK-2273 — signup lines wear the channel embed's emojis: the static
 * state glyphs from `SIGNUP_STATE_EMOJI`, role / class glyphs from the
 * same `DiscordEmojiService` calls the embed makes (operator ruling
 * 2026-11-20: "use the same emojis … as the discord embed").
 */
import { getMentionsForRole } from '../../../discord-bot/services/discord-embed.helpers';
import type { DiscordEmojiService } from '../../../discord-bot/services/discord-emoji.service';
import { UNICODE_FALLBACK } from '../../../discord-bot/services/discord-emoji.constants';
import {
  signupLine,
  signupLineEmoji,
  type SignupLineEmoji,
  type SignupLineInput,
  type SignupLineState,
} from './hub-forum-discord-signup-lines';

const ID = '111111111111111111';
const THRALL = { name: 'Thrall', className: 'Warrior', spec: 'Prot' };
const JAINA = { name: 'Jaina', className: 'Mage', spec: null };

/** Visible stand-ins, so a test names exactly which glyph landed where. */
const STUB: SignupLineEmoji = {
  role: (r) => `<${r}>`,
  klass: (c) => `[${c}]`,
};
const NONE: SignupLineEmoji = { role: () => '', klass: () => '' };

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
): SignupLineInput {
  return {
    discordId: ID,
    displayName: 'Bob',
    previous,
    current,
    mentioned: true,
  };
}

const text = (i: SignupLineInput, emoji: SignupLineEmoji = STUB) =>
  signupLine(i, emoji)?.content ?? null;

describe('ROK-2273 — first-line detail carries role and class glyphs', () => {
  it('role glyph before the role, class glyph before the character', () => {
    expect(text(input(null, state()))).toBe(
      '✅ Bob signed up — <tank> Tank · [Warrior] Thrall (Prot Warrior)',
    );
  });

  it('no glyph when the resolver has none (flex, unsynced classes)', () => {
    expect(text(input(null, state()), NONE)).toBe(
      '✅ Bob signed up — Tank · Thrall (Prot Warrior)',
    );
  });

  it('a classless character gets no class glyph; bench gets none', () => {
    const s = state({
      bench: true,
      role: null,
      character: { ...JAINA, className: null },
    });
    expect(text(input(null, s))).toBe('✅ Bob signed up — Bench · Jaina');
  });

  it('a tentative first line leads with the embed hourglass', () => {
    expect(text(input(null, state({ status: 'tentative' })))).toBe(
      '⏳ Bob is tentative — <tank> Tank · [Warrior] Thrall (Prot Warrior)',
    );
  });
});

describe('ROK-2273 — change lines lead with the new glyph', () => {
  it('role change leads with the new role glyph', () => {
    expect(text(input(state(), state({ role: 'healer' })))).toBe(
      '<healer> Bob Tank → Healer',
    );
  });

  it('role change falls back to 🔁 when the new role has no glyph', () => {
    expect(text(input(state(), state({ role: 'healer' })), NONE)).toBe(
      '🔁 Bob Tank → Healer',
    );
  });

  it('promotion leads with the new role glyph, ⬆️ without one', () => {
    const was = state({ bench: true, role: null });
    const now = state({ role: 'dps' });
    expect(text(input(was, now))).toBe('<dps> Bob promoted from bench → DPS');
    expect(text(input(was, state({ role: null })))).toBe(
      '⬆️ Bob promoted from bench',
    );
  });

  it('character change leads with the class glyph, 🔁 without one', () => {
    const now = state({ character: JAINA });
    expect(text(input(state(), now))).toBe('[Mage] Bob now on Jaina (Mage)');
    expect(text(input(state(), now), NONE)).toBe('🔁 Bob now on Jaina (Mage)');
  });

  it('a character change never borrows the tank glyph (Unicode fallback)', () => {
    const real = signupLineEmoji({
      getRoleEmoji: (r: string) => UNICODE_FALLBACK[r] ?? '',
      getClassEmoji: () => '',
    });
    const line = text(input(state(), state({ character: JAINA })), real);
    expect(line).toBe('🔁 Bob now on Jaina (Mage)');
    expect(line).not.toContain(UNICODE_FALLBACK['tank'] ?? 'missing');
  });

  it('benched / tentative / late / roach-out / decline glyphs + words', () => {
    const cur = state();
    expect(text(input(cur, state({ bench: true, role: null })))).toBe(
      '🪑 Bob benched',
    );
    expect(text(input(cur, state({ status: 'tentative' })))).toBe(
      '⏳ Bob is now tentative',
    );
    expect(text(input(cur, state({ late: true })))).toBe(
      '⏰ Bob is running late',
    );
    expect(text(input(cur, state({ status: 'roached_out' })))).toBe(
      '🪳 Bob roached out',
    );
    expect(text(input(cur, state({ status: 'declined' })))).toBe(
      '👋 Bob declined',
    );
  });
});

describe('ROK-2273 — one vocabulary with the channel embed', () => {
  const CUSTOM: Record<string, string> = {
    tank: '<:rl_tank:42>',
    Warrior: '<:rl_warrior:43>',
  };
  const svc = {
    getRoleEmoji: (r: string) => CUSTOM[r] ?? '',
    getClassEmoji: (c: string) => CUSTOM[c] ?? '',
  };
  const embedSvc = svc as unknown as DiscordEmojiService;
  const mention = (over: { status?: string; runningLate?: boolean }) => ({
    discordId: ID,
    displayName: 'Bob',
    role: 'tank',
    preferredRoles: null,
    className: 'Warrior',
    status: over.status ?? 'signed_up',
    runningLate: over.runningLate ?? null,
  });
  const lead = (s: string | null) => (s ?? '').split(' ')[0] ?? '';

  it("a tentative line's glyph is the embed's tentative marker", () => {
    const roster = getMentionsForRole(
      [mention({ status: 'tentative' })],
      null,
      embedSvc,
    );
    const line = text(input(state(), state({ status: 'tentative' })));
    expect(roster).toContain(lead(line));
  });

  it("a running-late line's glyph is the embed's running-late marker", () => {
    const roster = getMentionsForRole(
      [mention({ runningLate: true })],
      null,
      embedSvc,
    );
    const line = text(input(state(), state({ late: true })));
    expect(roster).toContain(lead(line));
  });

  it('custom guild role + class emojis match the embed exactly', () => {
    const roster = getMentionsForRole([mention({})], null, embedSvc);
    const line = text(input(null, state()), signupLineEmoji(svc));
    expect(roster).toContain('<:rl_tank:42>');
    expect(roster).toContain('<:rl_warrior:43>');
    expect(line).toBe(
      '✅ Bob signed up — <:rl_tank:42> Tank · <:rl_warrior:43> Thrall (Prot Warrior)',
    );
  });
});
