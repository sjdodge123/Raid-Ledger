/**
 * ROK-1836 (review m1) — a blob whose `stat()` fails must not leak the open
 * file handle: `sizeOf` closes it before rethrowing.
 */
import type { FileHandle } from 'node:fs/promises';
import { sizeOf } from './valheim-armory-blob.controller';

describe('sizeOf', () => {
  it('closes the handle and rethrows when stat throws', async () => {
    const close = jest.fn(() => Promise.resolve());
    const boom = new Error('EIO');
    const file = {
      stat: () => Promise.reject(boom),
      close,
    } as unknown as FileHandle;
    await expect(sizeOf(file)).rejects.toBe(boom);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns the size and leaves the handle open on success', async () => {
    const close = jest.fn(() => Promise.resolve());
    const file = {
      stat: () => Promise.resolve({ size: 42 }),
      close,
    } as unknown as FileHandle;
    expect(await sizeOf(file)).toBe(42);
    expect(close).not.toHaveBeenCalled();
  });
});
