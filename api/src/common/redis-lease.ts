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

/**
 * Fixed-window counter: `INCR KEYS[1]` and, whenever the key has no expiry
 * (just created, or left without one), `EXPIRE` it for `ARGV[1]` seconds —
 * atomically, so the window can never become permanent. Returns the count.
 */
export const INCR_FIXED_WINDOW_LUA =
  "local n = redis.call('incr', KEYS[1]) if redis.call('ttl', KEYS[1]) < 0 then redis.call('expire', KEYS[1], ARGV[1]) end return n";
