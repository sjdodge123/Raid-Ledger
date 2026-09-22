import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type * as readline from 'node:readline';
import { pumpLines } from './log-download.stream';

/** A readline stand-in: pause() does not stop already-buffered lines. */
function fakeReadline() {
  const rl = new EventEmitter() as EventEmitter & {
    pause: jest.Mock;
    resume: jest.Mock;
  };
  rl.pause = jest.fn();
  rl.resume = jest.fn();
  return rl;
}

async function collect(out: PassThrough): Promise<string> {
  let text = '';
  out.setEncoding('utf8');
  for await (const chunk of out) text += chunk as string;
  return text;
}

describe('pumpLines (ROK-1164)', () => {
  it('keeps one drain listener and every line, in order, under backpressure', async () => {
    const rl = fakeReadline();
    const out = new PassThrough({ highWaterMark: 16 });
    pumpLines(
      rl as unknown as readline.Interface,
      out,
      (l) => l,
      () => out.end(),
    );
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`);
    for (const line of lines) rl.emit('line', line);
    rl.emit('close');

    expect(out.listenerCount('drain')).toBeLessThanOrEqual(1);
    expect(await collect(out)).toBe(lines.map((l) => `${l}\n`).join(''));
  });

  it('resumes readline once the queued lines have drained', async () => {
    const rl = fakeReadline();
    const out = new PassThrough({ highWaterMark: 4 });
    pumpLines(
      rl as unknown as readline.Interface,
      out,
      (l) => l,
      () => out.end(),
    );
    rl.emit('line', 'first-line');
    rl.emit('line', 'second-line');
    expect(rl.pause).toHaveBeenCalledTimes(1);
    const done = collect(out);
    await new Promise((r) => setImmediate(r));
    expect(rl.resume).toHaveBeenCalled();
    rl.emit('close');
    expect(await done).toBe('first-line\nsecond-line\n');
  });
});
