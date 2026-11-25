import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ZodBodyPipe } from './zod-body.pipe';

const Schema = z.object({ id: z.uuid(), name: z.string().max(3) });

function caught(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  throw new Error('expected the pipe to throw');
}

describe('ZodBodyPipe (ROK-1671 L7)', () => {
  const pipe = new ZodBodyPipe(Schema);

  it('returns the parsed value for a valid body, stripping unknown keys', () => {
    const id = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
    expect(pipe.transform({ id, name: 'ab', extra: 1 })).toEqual({
      id,
      name: 'ab',
    });
  });

  it('throws 400 validation_failed naming the paths, without echoing values', () => {
    const err = caught(() =>
      pipe.transform({ id: 'not-a-uuid-secret', name: 'toolong' }),
    );
    expect(err.getStatus()).toBe(400);
    const body = err.getResponse();
    expect(body).toMatchObject({ error: 'validation_failed' });
    const text = JSON.stringify(body);
    expect(text).toContain('id');
    expect(text).toContain('name');
    expect(text).not.toContain('not-a-uuid-secret');
    expect(text).not.toContain('toolong');
  });

  it('rejects a non-object body', () => {
    expect(caught(() => pipe.transform('nope')).getStatus()).toBe(400);
  });
});
