import { useMemo } from 'react';
import type { DiscordMemberSearchResult } from '../../lib/api-client';
import { useEvents } from '../../hooks/use-events';
import { useBranding } from '../../hooks/use-branding';
import { toast } from '../../lib/toast';

interface MemberListProps {
    members: DiscordMemberSearchResult[];
    isLoadingMembers: boolean;
    isSearching: boolean;
    searchQuery: string;
    isSubmitting: boolean;
    getMemberStatus: (member: DiscordMemberSearchResult) => 'invited' | 'signed_up' | 'member' | null;
    onMemberClick: (member: DiscordMemberSearchResult) => void;
}

function MemberAvatar({ member }: { member: DiscordMemberSearchResult }) {
    if (member.avatar) {
        return <img src={`https://cdn.discordapp.com/avatars/${member.discordId}/${member.avatar}.png?size=32`}
            alt="" className="w-7 h-7 rounded-full shrink-0" />;
    }
    return (
        <div className="w-7 h-7 rounded-full bg-indigo-500/30 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-indigo-300">{member.username[0]?.toUpperCase()}</span>
        </div>
    );
}

function statusColor(status: string | null): string {
    if (status === 'invited') return 'text-amber-400';
    if (status === 'signed_up') return 'text-emerald-400';
    return 'text-indigo-400';
}

function statusLabel(status: string | null): string {
    if (status === 'invited') return 'Already invited';
    if (status === 'signed_up') return 'Signed up';
    return 'Invite';
}

function MemberRow({ member, status, isSubmitting, onClick }: {
    member: DiscordMemberSearchResult; status: 'invited' | 'signed_up' | 'member' | null;
    isSubmitting: boolean; onClick: () => void;
}) {
    const isNonClickable = status === 'invited' || status === 'signed_up';
    return (
        <button key={member.discordId} type="button" onClick={onClick}
            disabled={isSubmitting || isNonClickable}
            className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${isNonClickable ? 'opacity-50 cursor-default' : 'hover:bg-panel disabled:opacity-50'}`}>
            <MemberAvatar member={member} />
            <span className="text-sm text-foreground font-medium truncate">{member.username}</span>
            <span className={`ml-auto text-xs shrink-0 ${statusColor(status)}`}>{statusLabel(status)}</span>
        </button>
    );
}

export function MemberList({ members, isLoadingMembers, isSearching, searchQuery, isSubmitting, getMemberStatus, onMemberClick }: MemberListProps) {
    return (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-edge bg-surface">
            {isLoadingMembers && members.length === 0 && <div className="px-3 py-4 text-center text-sm text-muted">Loading members...</div>}
            {isSearching && <div className="px-3 py-2 text-center text-xs text-muted">Searching...</div>}
            {members.map((member) => (
                <MemberRow key={member.discordId} member={member} status={getMemberStatus(member)}
                    isSubmitting={isSubmitting} onClick={() => onMemberClick(member)} />
            ))}
            {!isLoadingMembers && !isSearching && members.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted">
                    {searchQuery.trim() ? `No members matching "${searchQuery}"` : 'No members found'}
                </p>
            )}
        </div>
    );
}

function useMotdText() {
    const { brandingQuery } = useBranding();
    const communityName = brandingQuery.data?.communityName || 'Our Guild';
    const { data: upcomingEventsData } = useEvents({ upcoming: true, limit: 3 });

    return useMemo(() => {
        const siteHost = window.location.host;
        const lines = [`${communityName} -- ${siteHost}`];
        const events = upcomingEventsData?.data ?? [];
        if (events.length > 0) {
            const summaries = events.map((e) => {
                const d = new Date(e.startTime);
                const day = d.toLocaleDateString('en-US', { weekday: 'short' });
                const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
                return `${e.title} ${day} ${time}`;
            });
            lines.push(`Upcoming: ${summaries.join(' | ')}`);
        }
        lines.push(`Sign up & manage your characters at ${siteHost}`);
        return lines.join('\n');
    }, [communityName, upcomingEventsData]);
}

export function MotdSection() {
    const motdText = useMotdText();

    const handleCopyMotd = () => {
        navigator.clipboard.writeText(motdText)
            .then(() => toast.success('MOTD copied to clipboard!'))
            .catch(() => toast.error('Failed to copy MOTD'));
    };

    return (
        <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">MOTD Summary</label>
            <div className="relative rounded-lg border border-edge bg-surface">
                <pre className="p-3 pr-16 text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{motdText}</pre>
                <button type="button" onClick={handleCopyMotd} className="absolute top-2 right-2 btn btn-secondary btn-sm">Copy</button>
            </div>
            <p className="mt-1.5 text-xs text-dim">Paste this into your in-game guild MOTD or chat.</p>
        </div>
    );
}
