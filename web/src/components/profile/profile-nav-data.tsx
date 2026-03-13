export interface NavItem {
    to: string;
    label: string;
}

export interface NavSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    children: NavItem[];
}

const IdentityIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const PreferencesIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
);

const GamingIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const IntegrationsIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
);

const AccountIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
);

/**
 * Build profile sidebar navigation sections for the given user.
 * Returns sections with user-specific links (e.g., My Profile -> /users/{userId}).
 * Restructured from static SECTIONS array (ROK-548).
 */
export function getSections(userId: number): NavSection[] {
    return [
        {
            id: 'identity',
            label: 'Identity',
            icon: IdentityIcon,
            children: [
                { to: `/users/${userId}`, label: 'My Profile' },
                { to: '/profile/avatar', label: 'My Avatar' },
            ],
        },
        {
            id: 'integrations',
            label: 'Integrations',
            icon: IntegrationsIcon,
            children: [
                { to: '/profile/integrations', label: 'My Integrations' },
            ],
        },
        {
            id: 'preferences',
            label: 'Preferences',
            icon: PreferencesIcon,
            children: [
                { to: '/profile/preferences', label: 'Preferences' },
                { to: '/profile/notifications', label: 'Notifications' },
            ],
        },
        {
            id: 'gaming',
            label: 'Gaming',
            icon: GamingIcon,
            children: [
                { to: '/profile/gaming/game-time', label: 'Game Time' },
                { to: '/profile/gaming/characters', label: 'Characters' },
                { to: '/profile/gaming/watched-games', label: 'Watched Games' },
            ],
        },
        {
            id: 'account',
            label: 'Account',
            icon: AccountIcon,
            children: [
                { to: '/profile/account', label: 'Delete Account' },
            ],
        },
    ];
}
