/**
 * Redis lease primitives shared by production code and the in-memory test
 * mock (`common/testing/redis-mock.ts`), so the mock implements exactly the
 * script the app sends and nothing else.
 */

/**
 * Compare-and-delete: delete `KEYS[1]` only while it still holds the
 * caller's token `ARGV[1]` (an expired lease may already be re-held by
 * someone else). Returns 1 when deleted, 0 otherwise.
 */
export const COMPARE_AND_DELETE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
