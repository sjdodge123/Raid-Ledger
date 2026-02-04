import type { User } from '../../hooks/use-auth';

interface UserInfoCardProps {
    user: User;
}

/**
 * Displays user profile information: avatar, username, join date.
 */
export function UserInfoCard({ user }: UserInfoCardProps) {
    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128`
        : '/default-avatar.png';

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-4">
                <img
                    src={avatarUrl}
                    alt={user.username}
                    className="w-20 h-20 rounded-full bg-slate-700"
                    onError={(e) => {
                        e.currentTarget.src = '/default-avatar.png';
                    }}
                />
                <div>
                    <h2 className="text-2xl font-bold text-white">{user.username}</h2>
                    <p className="text-slate-400">Connected via Discord</p>
                </div>
            </div>
        </div>
    );
}
