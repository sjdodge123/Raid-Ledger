import { useState } from 'react';
import type {
    BindingPurpose,
    ChannelType,
    CreateChannelBindingDto,
    IgdbGameDto,
} from '@raid-ledger/contract';
import { classifyBindingTriple } from '@raid-ledger/contract';
import { GameSearchInput } from '../events/game-search-input';

export interface BindingChannelOption {
    id: string;
    name: string;
    channelType: ChannelType;
}

interface BindingCreateFormProps {
    channels: BindingChannelOption[];
    onCreate: (dto: CreateChannelBindingDto) => void | Promise<unknown>;
    isCreating: boolean;
    createError?: string | null;
}

const PURPOSE_LABELS: Record<BindingPurpose, string> = {
    'game-announcements': 'Announcements',
    'game-voice-monitor': 'Activity Monitor',
    'general-lobby': 'General Lobby',
    'lfg-board': 'LFG board',
};

const PURPOSE_BY_TYPE: Record<ChannelType, BindingPurpose[]> = {
    voice: ['game-voice-monitor', 'general-lobby'],
    text: ['game-announcements'],
    forum: ['lfg-board'],
};

function ChannelSelect({ channels, value, onChange }: {
    channels: BindingChannelOption[]; value: string; onChange: (id: string) => void;
}) {
    return (
        <div>
            <label htmlFor="new-binding-channel" className="block text-xs text-muted mb-1">Channel</label>
            <select id="new-binding-channel" value={value} onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                <option value="">Select a channel…</option>
                {channels.map((c) => (
                    <option key={`${c.channelType}:${c.id}`} value={c.id}>
                        {c.channelType === 'voice' ? '🔊 ' : '#'}{c.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

function PurposeSelect({ channelType, value, onChange }: {
    channelType: ChannelType | undefined; value: BindingPurpose; onChange: (p: BindingPurpose) => void;
}) {
    const options = channelType ? PURPOSE_BY_TYPE[channelType] : [];
    return (
        <div>
            <label htmlFor="new-binding-purpose" className="block text-xs text-muted mb-1">Purpose</label>
            <select id="new-binding-purpose" aria-label="Purpose" value={value} disabled={!channelType}
                onChange={(e) => onChange(e.target.value as BindingPurpose)}
                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                {options.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
            </select>
        </div>
    );
}

function CreateActions({ canCreate, isCreating, onCancel }: { canCreate: boolean; isCreating: boolean; onCancel: () => void }) {
    return (
        <div className="flex gap-2 pt-1">
            <button type="submit" disabled={!canCreate}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors">
                {isCreating ? 'Creating...' : 'Create binding'}
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2 bg-overlay hover:bg-faint text-foreground rounded-lg text-sm transition-colors">Cancel</button>
        </div>
    );
}

function useCreateBindingForm(channels: BindingChannelOption[]) {
    const [channelId, setChannelId] = useState('');
    const [purpose, setPurpose] = useState<BindingPurpose>('game-voice-monitor');
    const [game, setGame] = useState<IgdbGameDto | null>(null);

    const channelType = channels.find((c) => c.id === channelId)?.channelType;
    const gameId = game?.id ?? null;
    const violation = channelType ? classifyBindingTriple(channelType, purpose, gameId) : null;

    const handleChannelChange = (id: string) => {
        setChannelId(id);
        const next = channels.find((c) => c.id === id)?.channelType;
        if (next) setPurpose(PURPOSE_BY_TYPE[next][0]);
        setGame(null);
    };

    const reset = () => { setChannelId(''); setPurpose('game-voice-monitor'); setGame(null); };

    return { channelId, purpose, setPurpose, game, setGame, channelType, gameId, violation, handleChannelChange, reset };
}

/**
 * Create a channel binding (ROK-1416, AC3) — wires the previously dead
 * createBinding hook behind the "…or add one below" copy. The same shared
 * classifier that gates the edit form gates Create, so the UI structurally
 * cannot mint the inert (voice monitor, no game) triple.
 */
export function BindingCreateForm({ channels, onCreate, isCreating, createError }: BindingCreateFormProps) {
    const [open, setOpen] = useState(false);
    const f = useCreateBindingForm(channels);

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)}
                className="px-4 py-2 bg-overlay hover:bg-faint text-foreground rounded-lg text-sm transition-colors">
                + Add binding
            </button>
        );
    }

    const showGameField = f.purpose !== 'general-lobby';
    const canCreate = !!f.channelId && !!f.channelType && f.violation == null && !isCreating;
    const close = () => { f.reset(); setOpen(false); };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.channelType || !canCreate) return;
        const dto: CreateChannelBindingDto = {
            channelId: f.channelId, channelType: f.channelType, bindingPurpose: f.purpose, gameId: f.gameId,
        };
        Promise.resolve(onCreate(dto)).then(close).catch(() => {});
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-overlay/30 rounded-lg border border-edge">
            <h4 className="text-sm font-medium text-foreground">New binding</h4>
            <ChannelSelect channels={channels} value={f.channelId} onChange={f.handleChannelChange} />
            <PurposeSelect channelType={f.channelType} value={f.purpose} onChange={f.setPurpose} />
            {showGameField && (
                <GameSearchInput id="new-binding-game" value={f.game} onChange={f.setGame}
                    error={f.violation?.field === 'gameId' ? f.violation.message : undefined} />
            )}
            {createError && <p className="text-sm text-red-400" role="alert">{createError}</p>}
            <CreateActions canCreate={canCreate} isCreating={isCreating} onCancel={close} />
        </form>
    );
}
