import { KeyedSerializer } from './hub-forum-discord.bind-lock';

/** A task that records its start/end around one macrotask of "work". */
function tracked(log: string[], name: string, fail = false) {
  return async (): Promise<string> => {
    log.push(`${name}:start`);
    await new Promise((r) => setImmediate(r));
    log.push(`${name}:end`);
    if (fail) throw new Error(`${name} failed`);
    return name;
  };
}

describe('ROK-2208 KeyedSerializer (shared-forum bind lock)', () => {
  it('runs tasks for the same key one at a time, in order', async () => {
    const lock = new KeyedSerializer();
    const log: string[] = [];
    await Promise.all([
      lock.run('g1', tracked(log, 'a')),
      lock.run('g1', tracked(log, 'b')),
    ]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different keys run concurrently', async () => {
    const lock = new KeyedSerializer();
    const log: string[] = [];
    await Promise.all([
      lock.run('g1', tracked(log, 'a')),
      lock.run('g2', tracked(log, 'b')),
    ]);
    expect(log.slice(0, 2)).toEqual(['a:start', 'b:start']);
  });

  it('a failed task rejects its caller but never blocks the next', async () => {
    const lock = new KeyedSerializer();
    const log: string[] = [];
    const first = lock.run('g1', tracked(log, 'a', true));
    const second = lock.run('g1', tracked(log, 'b'));
    await expect(first).rejects.toThrow('a failed');
    await expect(second).resolves.toBe('b');
  });
});
