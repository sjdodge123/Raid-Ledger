/**
 * SimilarGamesRequestSchema refine rule (ROK-1102 item 7).
 *
 * The schema accepts exactly one of `userId`, `userIds` or `gameId` — the three
 * are different similarity queries, and supplying two would leave the handler
 * silently picking one. The positive paths were covered implicitly by callers;
 * the rejections were not covered at all, which is the half that protects the
 * handler from ambiguous input.
 */
import { SimilarGamesRequestSchema } from '@raid-ledger/contract';

describe('SimilarGamesRequestSchema — exactly-one selector', () => {
  it.each([
    ['userId', { userId: 7 }],
    ['userIds', { userIds: [7, 8] }],
    ['gameId', { gameId: 42 }],
  ])('accepts %s on its own', (_label, body) => {
    expect(SimilarGamesRequestSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = SimilarGamesRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it.each([
    ['userId + gameId', { userId: 7, gameId: 42 }],
    ['userId + userIds', { userId: 7, userIds: [8] }],
    ['userIds + gameId', { userIds: [8], gameId: 42 }],
    ['all three', { userId: 7, userIds: [8], gameId: 42 }],
  ])('rejects %s', (_label, body) => {
    expect(SimilarGamesRequestSchema.safeParse(body).success).toBe(false);
  });

  it('explains which fields are mutually exclusive', () => {
    const result = SimilarGamesRequestSchema.safeParse({
      userId: 7,
      gameId: 42,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toContain(
      'Exactly one of userId, userIds, or gameId must be provided',
    );
  });

  it('defaults limit to 10 once the selector is valid', () => {
    const result = SimilarGamesRequestSchema.safeParse({ gameId: 42 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.limit).toBe(10);
  });

  it('still rejects an out-of-range limit alongside a valid selector', () => {
    expect(
      SimilarGamesRequestSchema.safeParse({ gameId: 42, limit: 51 }).success,
    ).toBe(false);
  });
});
