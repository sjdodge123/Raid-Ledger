import * as fs from 'node:fs';
import { readBounded } from './log-files.helpers';

/** A file handle whose `stat` size is stale versus what `read` delivers. */
function fakeHandle(statSize: number, reads: string[]) {
  const queue = [...reads];
  return {
    stat: jest.fn().mockResolvedValue({ size: statSize }),
    read: jest.fn((buf: Buffer, offset: number) => {
      const next = Buffer.from(queue.shift() ?? '');
      next.copy(buf, offset);
      return Promise.resolve({ bytesRead: next.length, buffer: buf });
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('readBounded (ROK-1164)', () => {
  afterEach(() => jest.restoreAllMocks());

  function openWith(handle: ReturnType<typeof fakeHandle>) {
    jest
      .spyOn(fs.promises, 'open')
      .mockResolvedValue(handle as unknown as fs.promises.FileHandle);
  }

  it('drops the zero-filled tail when the file shrank after stat', async () => {
    openWith(fakeHandle(20, ['hello', '']));
    const body = await readBounded('/logs/api.log', 1024);
    expect(body?.includes(0)).toBe(false);
    expect(body?.toString()).toBe('hello');
  });

  it('keeps reading after a short read instead of treating it as EOF', async () => {
    const handle = fakeHandle(11, ['hello', ' world', '']);
    openWith(handle);
    const body = await readBounded('/logs/api.log', 1024);
    expect(body?.toString()).toBe('hello world');
    expect(handle.close).toHaveBeenCalled();
  });
});
