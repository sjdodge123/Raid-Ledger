/**
 * Pure helpers that carve the demo-user list into smoke roles.
 *
 * Kept free of Discord/API imports so `demo-data.spec.ts` can assert on them
 * in the plain unit gate (`scripts/run-unit-specs.sh`).
 */

export interface DemoUser {
  id: number;
  username: string;
}

/**
 * The demo user that acts as the smoke operator (ROK-1628): the first user
 * not already claimed by the test user or the DM recipient.
 */
export function pickOperatorUser(
  allUsers: DemoUser[],
  taken: number[],
): DemoUser | undefined {
  return allUsers.find((u) => !taken.includes(u.id));
}

/**
 * Derive the game list and roster demo user IDs from setup results.
 *
 * `excludedUserIds` must name EVERY user setup has repurposed — the test user,
 * the DM recipient AND the operator. The operator carries a synthetic Discord
 * id, so a DM to it 10013s and the user is deactivated; handing it out as a
 * roster/invitee id then 404s (`Unknown user id(s)`) in tests such as the
 * lineup grace countdown.
 */
export function buildDemoData(
  allUsers: DemoUser[],
  excludedUserIds: number[],
  mmoGameId: number | undefined,
) {
  const gamesSet = new Set(
    allUsers.length > 0
      ? [mmoGameId].filter((id): id is number => id !== undefined)
      : [],
  );
  const games = [...gamesSet].map((id) => ({ id, name: `Game ${id}` }));
  const demoUserIds = allUsers
    .map((u) => u.id)
    .filter((id) => !excludedUserIds.includes(id))
    .slice(0, 8);
  console.log(`  ${demoUserIds.length} demo users available for roster tests`);
  return { games, demoUserIds };
}
