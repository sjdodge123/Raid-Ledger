/** ROK-2208 review M2 — the pin echo ledger never grows without bound. */
import { PinEchoes } from './hub-forum-discord-pins';

describe('PinEchoes (pin-sync echo suppression)', () => {
  it('consumes our own flip once, inside its window', () => {
    const echoes = new PinEchoes(1_000);
    echoes.record('p1', true, 0);
    expect(echoes.consume('p1', false, 10)).toBe(false);
    expect(echoes.consume('p1', true, 10)).toBe(true);
    expect(echoes.consume('p1', true, 20)).toBe(false);
  });

  it('treats an echo arriving after the window as a user flip', () => {
    const echoes = new PinEchoes(1_000);
    echoes.record('p1', true, 0);
    expect(echoes.consume('p1', true, 1_001)).toBe(false);
    expect(echoes.size).toBe(0);
  });

  it('prunes expired never-echoed flips when the next one is recorded', () => {
    const echoes = new PinEchoes(1_000);
    echoes.record('p1', true, 0);
    echoes.record('p2', false, 500);
    expect(echoes.size).toBe(2);
    echoes.record('p3', true, 1_200); // p1 expired at 1000; p2 still live
    expect(echoes.size).toBe(2);
    expect(echoes.consume('p2', false, 1_200)).toBe(true);
    expect(echoes.consume('p1', true, 1_200)).toBe(false);
  });
});
