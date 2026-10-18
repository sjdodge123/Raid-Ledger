import { HttpException } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** `packages/contract/valheim-link/v1/fixtures` from this folder. */
export const VALHEIM_LINK_FIXTURES = join(
  __dirname,
  '../../../../../../packages/contract/valheim-link/v1/fixtures',
);

/** A fixture as a mutable JSON object. */
export function loadValheimFixture(
  name: string,
  dir: string = VALHEIM_LINK_FIXTURES,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(join(dir, `${name}.json`), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${name} is not an object`);
  }
  return { ...parsed };
}

/** Fixture names (no `.json`, no EXPECTED) in `dir`. */
export function valheimFixtureNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** `{ status, body }` of the HttpException a promise rejects with. */
export async function rejection(
  p: Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err: unknown) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
  throw new Error('expected a rejection');
}
