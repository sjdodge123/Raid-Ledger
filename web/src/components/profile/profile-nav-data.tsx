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

const NotificationsIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
);

const GamingIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const AccountIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

/**
 * Consolidated profile navigation (ROK-359).
 * Flat structure: 5 items instead of 4 sections with 9+ items.
 * Each section has a single nav item pointing to the consolidated page.
 */
export const SECTIONS: NavSection[] = [
    {
        id: 'identity',
        label: 'Identity',
        icon: IdentityIcon,
        children: [
            { to: '/profile/identity', label: 'My Profile' },
        ],
    },
    {
        id: 'preferences',
        label: 'Preferences',
        icon: PreferencesIcon,
        children: [
            { to: '/profile/preferences', label: 'Preferences' },
        ],
    },
    {
        id: 'notifications',
        label: 'Notifications',
        icon: NotificationsIcon,
        children: [
            { to: '/profile/notifications', label: 'Notifications' },
        ],
    },
    {
        id: 'gaming',
        label: 'Gaming',
        icon: GamingIcon,
        children: [
            { to: '/profile/gaming', label: 'Gaming' },
        ],
    },
    {
        id: 'account',
        label: 'Account',
        icon: AccountIcon,
        children: [
            { to: '/profile/account', label: 'Account' },
        ],
    },
];
