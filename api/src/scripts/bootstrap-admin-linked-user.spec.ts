/**
 * ROK-1331 M6a — bootstrap-admin UPDATE-when-linked branch (TDD red).
 *
 * Spec ROK-1331-M6a §"Bootstrap-admin contract addition":
 *   When the env's `users` table already has an admin row whose `discord_id`
 *   is NOT NULL and NOT `local:%`, bootstrap-admin MUST attach the
 *   `local_credentials` row to that user instead of inserting a duplicate
 *   `local:admin@local` placeholder. Three branches:
 *     1. linkedUser present + existingCred.userId === linkedUser.id
 *          → just reset password.
 *     2. linkedUser present + existingCred.userId !== linkedUser.id
 *          → DELETE orphan placeholder, INSERT cred bound to linkedUser.id.
 *     3. linkedUser absent → existing behavior (INSERT placeholder).
 *
 * Today's bootstrap-admin.ts ONLY handles branches 1 and 3. M6a dev MUST
 * add the linked-user resolver + the UPDATE branch. This test should FAIL
 * until that lands.
 *
 * We don't boot a real Postgres for this test (the integration runner is
 * heavy and the script doesn't export its core function). Instead, we
 * inspect the script's TEXT for the contract markers the dev MUST add,
 * mirroring the pre-merge gate the architect requires.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('ROK-1331 M6a — bootstrap-admin linked-user branch', () => {
  const SCRIPT_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    'scripts',
    'bootstrap-admin.ts',
  );
  const scriptText = fs.existsSync(SCRIPT_PATH)
    ? fs.readFileSync(SCRIPT_PATH, 'utf8')
    : '';

  it('script file exists at api/scripts/bootstrap-admin.ts', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('resolves a linkedUser via a SELECT on users.discord_id with admin role', () => {
    // The dev MUST add a select that filters on:
    //   discord_id IS NOT NULL AND discord_id NOT LIKE 'local:%' AND role = 'admin'
    // Defensive grep — accept drizzle syntax (eq/and/not/isNotNull/like)
    // OR raw SQL. The presence of `linkedUser` (or equivalent symbol) +
    // a NOT-LIKE check on `local:%` is the load-bearing signal.
    expect(scriptText).toMatch(/linkedUser|linked_user|linked-user/i);
    expect(scriptText).toMatch(/local:%|notLike|NOT LIKE/i);
  });

  it('detects orphan local-credential mismatch (existingCred.userId !== linkedUser.id)', () => {
    // The branch where existingCred.userId !== linkedUser.id MUST trigger
    // DELETE of the orphan `local:admin@local` user. Look for either a
    // DELETE FROM users discord_id="local:admin@local" or a drizzle
    // .delete(users).where(eq(discordId, 'local:admin@local')) shape.
    const hasOrphanDelete =
      /delete[\s\S]{0,200}local:admin@local/i.test(scriptText) ||
      /\.delete\(\s*\w+\.users\s*\)[\s\S]{0,200}local:admin@local/i.test(
        scriptText,
      );
    expect(hasOrphanDelete).toBe(true);
  });

  it('binds local_credentials.userId to the linkedUser when present', () => {
    // The new INSERT path MUST set userId to linkedUser.id (not the
    // placeholder adminUser.id). Look for an insert that references
    // linkedUser.id explicitly.
    expect(scriptText).toMatch(/userId:\s*linkedUser\.id|user_id:\s*linkedUser\.id/);
  });

  it('logs the active branch (linked-user mode vs local-admin mode)', () => {
    // Spec line 68: bootstrap-admin SHOULD log loudly which branch it
    // took. Operators need to spot misroutes during a sync.
    expect(scriptText).toMatch(/linked-user mode|local-admin mode|linkedUser mode/);
  });
});
