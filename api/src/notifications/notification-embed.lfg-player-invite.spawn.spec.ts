/**
 * ROK-1619 AC7 — the invite DM's Join button wears the praise-sun indicator
 * when (and only when) the send-time payload says the press forms the group.
 *
 * Bots cannot press another bot's buttons, so the builder is tested directly.
 */
import { LFG_BUTTON_IDS } from '../discord-bot/discord-bot.constants';
import {
  LFG_NOW_INDICATOR_UNICODE,
  LFG_NOW_SPAWN_BUTTON_LABEL,
} from '../discord-bot/lfg-now/lfg-now-indicator.helpers';
import {
  LFG_INVITE_JOIN_LABEL,
  LFG_INVITE_JOIN_SPAWN_LABEL,
  buildLfgPlayerInviteRow,
} from './notification-embed.lfg-player-invite';

interface ButtonJson {
  custom_id?: string;
  label?: string;
  emoji?: { id?: string; name?: string };
}

/** The Join button's wire JSON, from a payload. */
function joinButton(payload: Record<string, unknown>): ButtonJson {
  const row = buildLfgPlayerInviteRow({ gameId: 42, ...payload });
  if (!row) throw new Error('expected an invite row for a valid gameId');
  return row.components[0].toJSON() as ButtonJson;
}

describe('invite DM Join button — ROK-1619 AC7 indicator', () => {
  it('carries the spawn label and the Unicode sun when spawnsNow is true', () => {
    const join = joinButton({ spawnsNow: true });
    expect(join.label).toBe(LFG_INVITE_JOIN_SPAWN_LABEL);
    expect(join.emoji).toEqual({ name: LFG_NOW_INDICATOR_UNICODE });
  });

  it('keeps the plain label and no emoji when spawnsNow is absent', () => {
    const join = joinButton({});
    expect(join.label).toBe(LFG_INVITE_JOIN_LABEL);
    expect(join.emoji).toBeUndefined();
  });

  it('treats a non-boolean spawnsNow as no — only a literal true marks it', () => {
    expect(joinButton({ spawnsNow: 'true' }).label).toBe(LFG_INVITE_JOIN_LABEL);
  });

  it('never changes the custom id — the mark changes how it reads, not what it writes', () => {
    expect(joinButton({ spawnsNow: true }).custom_id).toBe(
      `${LFG_BUTTON_IDS.INVITE_JOIN}:42`,
    );
  });

  it('says what the press does in words (AC6), inside the 80-char cap, like the board', () => {
    expect(LFG_INVITE_JOIN_SPAWN_LABEL).toMatch(/starts the group/);
    expect(LFG_NOW_SPAWN_BUTTON_LABEL).toMatch(/starts the group/);
    expect(LFG_INVITE_JOIN_SPAWN_LABEL.length).toBeLessThanOrEqual(80);
  });
});
