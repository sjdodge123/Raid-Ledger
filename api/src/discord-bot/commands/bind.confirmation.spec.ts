import {
  buildRejectEmbed,
  buildWarningEmbed,
  checkMultiMonitor,
} from './bind.confirmation';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('checkMultiMonitor', () => {
  it('returns proceed when behavior is not game-voice-monitor', () => {
    const result = checkMultiMonitor([], 'game-announcements', null);
    expect(result).toEqual({ action: 'proceed' });
  });

  it('returns proceed when no existing bindings', () => {
    const result = checkMultiMonitor([], 'game-voice-monitor', 5);
    expect(result).toEqual({ action: 'proceed' });
  });

  it('returns reject when same game is already bound', () => {
    const existing = [{ id: 'b1', gameId: 5 }];
    const result = checkMultiMonitor(existing, 'game-voice-monitor', 5);
    expect(result.action).toBe('reject');
    if (result.action === 'reject') {
      expect(result.message).toContain('already bound');
    }
  });

  it('returns confirm without gameName when different game is bound', () => {
    const existing = [{ id: 'b1', gameId: 3 }];
    const result = checkMultiMonitor(existing, 'game-voice-monitor', 5);
    expect(result).toEqual({ action: 'confirm' });
  });
});

/**
 * ROK-1462 slice D rewrote these two embeds onto the shared command-reply
 * chrome (D5): the conflict reject is `cancelled` (red) with `✕ BINDING
 * REJECTED`, the multi-monitor warning is `needs_you` (amber) with
 * `⚠ CONFIRM BINDING`. Neither family sets a colour of its own any more.
 */
describe('buildRejectEmbed / buildWarningEmbed (ROK-1462 D5)', () => {
  it('renders the conflict reject as cancelled with the reject author line', () => {
    const embed = buildRejectEmbed(
      'This channel is already bound to this game.',
    );
    expect(embed.data.color).toBe(EMBED_COLORS.ERROR);
    expect(embed.data.author?.name).toBe('✕ BINDING REJECTED');
    expect(embed.data.description).toContain('already bound');
    expect(embed.data.title).toBeUndefined();
  });

  it('renders the multi-monitor warning as needs_you with the confirm author line', () => {
    const embed = buildWarningEmbed();
    expect(embed.data.color).toBe(EMBED_COLORS.REMINDER);
    expect(embed.data.author?.name).toBe('⚠ CONFIRM BINDING');
    expect(embed.data.description).toContain('Continue?');
    expect(embed.data.title).toBeUndefined();
  });
});
