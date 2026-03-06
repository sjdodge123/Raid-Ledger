/** Sort signups alphabetically by username (case-insensitive) */
export function alphabetical(
    a: { user: { username: string } },
    b: { user: { username: string } },
): number {
    return a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' });
}
