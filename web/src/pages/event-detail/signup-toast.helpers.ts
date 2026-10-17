/** ROK-626: Determine toast content for signup feedback. */

interface SignupToast {
    title: string;
    description: string;
}

/**
 * Returns appropriate toast title and description based on assigned slot.
 * When the user is placed on the bench (roster full), shows bench-specific messaging.
 */
export function getSignupToast(
    assignedSlot: string | null | undefined,
): SignupToast {
    if (assignedSlot === 'bench') {
        return {
            title: 'Placed on the bench',
            description:
                'The roster is full. You will be promoted when a slot opens up.',
        };
    }
    return {
        title: 'Successfully signed up!',
        description: "You're on the roster!",
    };
}
