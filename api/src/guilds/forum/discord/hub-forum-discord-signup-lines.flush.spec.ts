import { lineMessages } from './hub-forum-discord-signup-lines.flush';

const line = (n: number, mention: boolean, len = 40) => ({
  discordId: `1000000000000000${String(n).padStart(2, '0')}`,
  content: `L${n}`.padEnd(len, 'x'),
  mention,
});

describe('ROK-2271 lineMessages', () => {
  it('puts every line in one message, one line each, pinging only mention lines', () => {
    const msgs = lineMessages([line(1, true), line(2, false)]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content.split('\n')).toEqual([
      line(1, true).content,
      line(2, false).content,
    ]);
    expect(msgs[0]?.userIds).toEqual([line(1, true).discordId]);
  });

  it('splits at 2000 chars between lines and never cuts a line', () => {
    const lines = [1, 2, 3].map((n) => line(n, false, 900));
    const msgs = lineMessages(lines);
    expect(msgs.map((m) => m.lines.length)).toEqual([2, 1]);
    expect(msgs.every((m) => m.content.length <= 2000)).toBe(true);
    expect(msgs.flatMap((m) => m.content.split('\n'))).toEqual(
      lines.map((l) => l.content),
    );
  });

  it('splits at 100 mentions', () => {
    const lines = Array.from({ length: 101 }, (_, i) => line(i, true, 5));
    expect(lineMessages(lines).map((m) => m.userIds.length)).toEqual([100, 1]);
  });

  it('posts nothing for no lines', () => {
    expect(lineMessages([])).toEqual([]);
  });
});
