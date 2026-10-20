/**
 * ROK-1868 L3a — pure pieces of `HubPostsService`: request parsing (400 with
 * `flatten().fieldErrors`, like `guild-profile.service.ts`), the body
 * pipeline (Zod → `normalizeHubPostBody` → re-check) and the relay timeout.
 */
import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import { normalizeHubPostBody } from './hub-post-markdown.helpers';

/** D7: the relay is awaited inside `POST …/posts` for at most this long. */
export const HUB_POST_RELAY_TIMEOUT_MS = 5000;

/** `safeParse` or 400 with the per-field messages. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/**
 * §2.4: normalise a validated body; normalising only shrinks, so the one
 * re-check needed is "nothing left" (e.g. a zero-width-only body).
 */
export function finalBody(validated: string): string {
  const body = normalizeHubPostBody(validated);
  if (body.trim() === '') {
    throw new BadRequestException({ body: ['Post cannot be empty'] });
  }
  return body;
}

/** Resolve `work`, or `fallback` once `ms` elapse (the timer never leaks). */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
