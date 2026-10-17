/** Sort signups alphabetically by username (case-insensitive) */
export function alphabetical(
    a: { user: { username: string } },
    b: { user: { username: string } },
): number {
    return a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' });
}

/**
 * Whether the attendee roster lists this signup at all — declined signups are
 * hidden (departed ones get their own group). Shared so other sections can
 * tell who the roster shows (ROK-1822).
 */
export function isRosterShownSignup(signup: { status?: string | undefined }): boolean {
    return signup.status !== 'declined';
}
