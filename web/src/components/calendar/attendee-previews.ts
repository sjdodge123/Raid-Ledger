import type { CalendarEvent } from './CalendarView';

type SignupUser = NonNullable<NonNullable<CalendarEvent['resource']>['signupsPreview']>[number];

/** AttendeeAvatars' input: avatar fields the API left out stay absent instead of explicitly undefined. */
export function toAttendeePreviews(signups: SignupUser[] | undefined) {
    return signups?.map(({ customAvatarUrl, characters, ...rest }) => ({
        ...rest,
        ...(customAvatarUrl === undefined ? {} : { customAvatarUrl }),
        ...(characters === undefined ? {} : { characters }),
    }));
}
