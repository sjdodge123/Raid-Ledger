import { checkMultiMonitor } from './bind.confirmation';

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
