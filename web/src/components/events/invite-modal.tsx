/**
 * InviteModal - Invite players to an event via Discord (ROK-292, ROK-263).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import {
    listDiscordMembers,
    searchDiscordMembers,
    inviteMember,
    shareEventToDiscord,
    type DiscordMemberSearchResult,
} from '../../lib/api-client';
import { useCreatePug } from '../../hooks/use-pugs';
import { MemberList, MotdSection } from './invite-modal-sections';

interface InviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    existingPugUsernames?: Set<string>;
    signedUpDiscordIds?: Set<string>;
    isMMOGame?: boolean;
}

function useInviteModalMembers(isOpen: boolean) {
    const [members, setMembers] = useState<DiscordMemberSearchResult[]>([]);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isOpen) { setIsLoadingMembers(true); listDiscordMembers().then(setMembers).catch(() => setMembers([])).finally(() => setIsLoadingMembers(false)); }
    }, [isOpen]);

    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (value.trim().length < 2) { setIsSearching(false); return; }
        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try { const results = await searchDiscordMembers(value.trim()); setMembers(results); } catch { /* keep existing */ } finally { setIsSearching(false); }
        }, 300);
    }, []);

    useEffect(() => { if (searchQuery.trim().length === 0 && isOpen) listDiscordMembers().then(setMembers).catch(() => {}); }, [searchQuery, isOpen]);
    useEffect(() => { return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); }; }, []);

    const reloadMembers = () => { listDiscordMembers().then(setMembers).catch(() => {}); };
    return { members, isLoadingMembers, searchQuery, setSearchQuery, isSearching, handleSearchChange, reloadMembers };
}

function useInviteModalState(isOpen: boolean) {
    const m = useInviteModalMembers(isOpen);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);

    useEffect(() => { if (!isOpen) { m.setSearchQuery(''); setIsSubmitting(false); setGeneratedInviteUrl(null); } }, [isOpen]);

    return { ...m, isSubmitting, setIsSubmitting, isSharing, setIsSharing, generatedInviteUrl, setGeneratedInviteUrl };
}

async function shareToDiscordAction(eventId: number, setIsSharing: (v: boolean) => void) {
    setIsSharing(true);
    try {
        const result = await shareEventToDiscord(eventId);
        if (result.channelsPosted > 0) {
            toast.success(`Shared to ${result.channelsPosted} channel${result.channelsPosted > 1 ? 's' : ''}`, {
                description: result.channelsSkipped > 0 ? `${result.channelsSkipped} channel${result.channelsSkipped > 1 ? 's' : ''} already had the event posted.` : undefined,
            });
        } else if (result.channelsSkipped > 0) {
            toast.info('Already shared', { description: 'This event was already posted to all bound channels.' });
        } else {
            toast.info('No channels configured', { description: 'Set up game channel bindings in Admin Settings to share events.' });
        }
    } catch (err) {
        toast.error('Failed to share', { description: err instanceof Error ? err.message : 'Please try again.' });
    } finally { setIsSharing(false); }
}

function ShareSection({ eventId, isSharing, setIsSharing }: { eventId: number; isSharing: boolean; setIsSharing: (v: boolean) => void }) {
    const handleCopyLink = () => { navigator.clipboard.writeText(window.location.href).then(() => toast.success('Event link copied to clipboard!')).catch(() => toast.error('Failed to copy link')); };

    return (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-panel border border-edge">
            <div className="flex-1 min-w-0"><p className="text-xs text-muted truncate">{window.location.href}</p></div>
            <button type="button" onClick={handleCopyLink} className="btn btn-secondary btn-sm shrink-0">Copy URL</button>
            <button type="button" onClick={() => void shareToDiscordAction(eventId, setIsSharing)} disabled={isSharing}
                className="btn btn-secondary btn-sm shrink-0" title="Share to Discord channels">{isSharing ? 'Sharing...' : 'Share'}</button>
        </div>
    );
}

const COPY_ICON_PATH = 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z';

async function generateInviteLink(createPug: ReturnType<typeof useCreatePug>, defaultPugRole: string, setIsSubmitting: (v: boolean) => void, setGeneratedInviteUrl: (v: string | null) => void) {
    setIsSubmitting(true);
    try {
        const pugSlot = await createPug.mutateAsync({ role: defaultPugRole });
        if (!pugSlot.inviteCode) { toast.error('Failed to generate invite link', { description: 'No invite code returned. Please try again.' }); return; }
        const inviteUrl = `${window.location.origin}/i/${pugSlot.inviteCode}`;
        setGeneratedInviteUrl(inviteUrl);
        await navigator.clipboard.writeText(inviteUrl);
        toast.success('Invite link copied to clipboard!');
    } catch (err) { toast.error('Failed to generate invite link', { description: err instanceof Error ? err.message : 'Please try again.' }); }
    finally { setIsSubmitting(false); }
}

function PugInviteSection({ eventId, isSubmitting, setIsSubmitting, generatedInviteUrl, setGeneratedInviteUrl, defaultPugRole }: {
    eventId: number; isSubmitting: boolean; setIsSubmitting: (v: boolean) => void;
    generatedInviteUrl: string | null; setGeneratedInviteUrl: (v: string | null) => void;
    defaultPugRole: string;
}) {
    const createPug = useCreatePug(eventId);
    return (
        <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">Invite a PUG</label>
            <button type="button" onClick={() => void generateInviteLink(createPug, defaultPugRole, setIsSubmitting, setGeneratedInviteUrl)} disabled={isSubmitting}
                className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={COPY_ICON_PATH} /></svg>
                {isSubmitting ? 'Generating...' : 'Generate Invite Link'}
            </button>
            {generatedInviteUrl && <InviteLinkDisplay url={generatedInviteUrl} />}
            <p className="mt-1.5 text-xs text-dim">Creates a shareable link anyone can use to join this event.</p>
        </div>
    );
}

function InviteLinkDisplay({ url }: { url: string }) {
    return (
        <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-surface border border-edge">
            <input type="text" readOnly value={url}
                className="flex-1 bg-transparent text-xs text-foreground border-none outline-none"
                onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button type="button" onClick={() => { navigator.clipboard.writeText(url).then(() => toast.success('Copied!')).catch(() => {}); }}
                className="shrink-0 text-xs text-dim hover:text-foreground transition-colors" title="Copy invite link">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </button>
        </div>
    );
}

function getMemberStatus(member: DiscordMemberSearchResult, existingPugUsernames?: Set<string>, signedUpDiscordIds?: Set<string>): 'invited' | 'signed_up' | 'member' | null {
    if (existingPugUsernames?.has(member.username.toLowerCase())) return 'invited';
    if (signedUpDiscordIds?.has(member.discordId)) return 'signed_up';
    if (member.isRegistered) return 'member';
    return null;
}

function filterDisplayMembers(members: DiscordMemberSearchResult[], searchQuery: string): DiscordMemberSearchResult[] {
    return searchQuery.trim().length >= 2
        ? members
        : members.filter((m) => !searchQuery.trim() || m.username.toLowerCase().includes(searchQuery.toLowerCase()));
}

async function handlePugInvite(
    createPug: ReturnType<typeof useCreatePug>, defaultPugRole: string, s: ReturnType<typeof useInviteModalState>,
    discordUsername: string, isOnServer = false,
) {
    s.setIsSubmitting(true);
    try {
        await createPug.mutateAsync({ discordUsername, role: defaultPugRole });
        toast.success(isOnServer ? `Invite sent to "${discordUsername}"` : `Added "${discordUsername}" as a guest invite`, {
            description: isOnServer ? 'They\'ll receive a Discord DM with the invite.' : 'They\'ll be invited via Discord once they join the server.',
        });
        s.setSearchQuery(''); s.reloadMembers();
    } catch (err) {
        toast.error('Failed to send invite', { description: err instanceof Error ? err.message : 'Please try again.' });
    } finally { s.setIsSubmitting(false); }
}

async function handleMemberInvite(eventId: number, s: ReturnType<typeof useInviteModalState>, discordId: string, username: string) {
    s.setIsSubmitting(true);
    try {
        await inviteMember(eventId, discordId);
        toast.success(`Invite sent to "${username}"`, { description: 'They\'ll receive a Discord DM with the invite.' });
        s.setSearchQuery(''); s.reloadMembers();
    } catch (err) {
        toast.error('Failed to send invite', { description: err instanceof Error ? err.message : 'Please try again.' });
    } finally { s.setIsSubmitting(false); }
}

export function InviteModal({
    isOpen, onClose, eventId, existingPugUsernames, signedUpDiscordIds, isMMOGame = false,
}: InviteModalProps) {
    const createPug = useCreatePug(eventId);
    const defaultPugRole = isMMOGame ? 'dps' : 'player';
    const s = useInviteModalState(isOpen);
    const displayMembers = filterDisplayMembers(s.members, s.searchQuery);
    const statusGetter = (member: DiscordMemberSearchResult) => getMemberStatus(member, existingPugUsernames, signedUpDiscordIds);

    const handleMemberClick = (member: DiscordMemberSearchResult) => {
        const status = statusGetter(member);
        if (status === 'invited' || status === 'signed_up') return;
        if (status === 'member') { void handleMemberInvite(eventId, s, member.discordId, member.username); }
        else { void handlePugInvite(createPug, defaultPugRole, s, member.username, true); }
    };

    return (
        <InviteModalBody eventId={eventId} onClose={onClose} s={s} displayMembers={displayMembers}
            getMemberStatus={statusGetter} onMemberClick={handleMemberClick} defaultPugRole={defaultPugRole} />
    );
}

function InviteModalBody({ eventId, onClose, s, displayMembers, getMemberStatus: statusGetter, onMemberClick, defaultPugRole }: {
    eventId: number; onClose: () => void; s: ReturnType<typeof useInviteModalState>;
    displayMembers: DiscordMemberSearchResult[]; getMemberStatus: (m: DiscordMemberSearchResult) => 'invited' | 'signed_up' | 'member' | null;
    onMemberClick: (m: DiscordMemberSearchResult) => void; defaultPugRole: string;
}) {
    return (
        <Modal isOpen={true} onClose={onClose} title="Invite Players" maxWidth="max-w-lg">
            <div className="space-y-4">
                <ShareSection eventId={eventId} isSharing={s.isSharing} setIsSharing={s.setIsSharing} />
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">Discord Server Members</label>
                    <input type="text" value={s.searchQuery} onChange={(e) => s.handleSearchChange(e.target.value)}
                        placeholder="Search members..."
                        className="w-full px-3 py-2.5 rounded-lg border border-edge bg-panel text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" />
                </div>
                <MemberList members={displayMembers} isLoadingMembers={s.isLoadingMembers}
                    isSearching={s.isSearching} searchQuery={s.searchQuery}
                    isSubmitting={s.isSubmitting} getMemberStatus={statusGetter}
                    onMemberClick={onMemberClick} />
                <PugInviteSection eventId={eventId} isSubmitting={s.isSubmitting} setIsSubmitting={s.setIsSubmitting}
                    generatedInviteUrl={s.generatedInviteUrl} setGeneratedInviteUrl={s.setGeneratedInviteUrl}
                    defaultPugRole={defaultPugRole} />
                <MotdSection />
            </div>
        </Modal>
    );
}
