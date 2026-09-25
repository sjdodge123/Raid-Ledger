import { useState } from 'react';
import type {
    BindingPurpose,
    ChannelType,
    CreateChannelBindingDto,
    IgdbGameDto,
} from '@raid-ledger/contract';
import { classifyBindingTriple } from '@raid-ledger/contract';
import { GameSearchInput } from '../events/game-search-input';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Select } from '../ui/select';

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
        <Field id="new-binding-channel" label="Channel">
            <Select value={value} placeholder="Select a channel…" onChange={(e) => onChange(e.target.value)}>
                {channels.map((c) => (
                    <option key={`${c.channelType}:${c.id}`} value={c.id}>
                        {c.channelType === 'voice' ? '🔊 ' : '#'}{c.name}
                    </option>
                ))}
            </Select>
        </Field>
    );
}

function PurposeSelect({ channelType, value, onChange }: {
    channelType: ChannelType | undefined; value: BindingPurpose; onChange: (p: BindingPurpose) => void;
}) {
    const options = channelType ? PURPOSE_BY_TYPE[channelType] : [];
    return (
        <Field id="new-binding-purpose" label="Purpose">
            <Select value={value} disabled={!channelType} onChange={(e) => onChange(e.target.value as BindingPurpose)}>
                {options.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
            </Select>
        </Field>
    );
}

/** Create is disabled only by validation; a pending create is Button `loading` (ROK-1652 ruling 7). */
function CreateActions({ canCreate, isCreating, onCancel }: { canCreate: boolean; isCreating: boolean; onCancel: () => void }) {
    return (
        <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={!canCreate} loading={isCreating} loadingLabel="Creating...">
                Create binding
            </Button>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
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

/** The open form: channel, purpose, game (unless General Lobby), error and actions. */
function CreateBindingFields({ channels, onCreate, isCreating, createError, onClose }: BindingCreateFormProps & {
    onClose: () => void;
}) {
    const f = useCreateBindingForm(channels);
    const canCreate = !!f.channelId && !!f.channelType && f.violation == null;
    const close = () => { f.reset(); onClose(); };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.channelType || !canCreate || isCreating) return;
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
            {f.purpose !== 'general-lobby' && (
                <GameSearchInput id="new-binding-game" value={f.game} onChange={f.setGame}
                    error={f.violation?.field === 'gameId' ? f.violation.message : undefined} />
            )}
            {createError && <p className="text-sm text-danger" role="alert">{createError}</p>}
            <CreateActions canCreate={canCreate} isCreating={isCreating} onCancel={close} />
        </form>
    );
}

/**
 * Create a channel binding (ROK-1416, AC3) — wires the previously dead
 * createBinding hook behind the "…or add one below" copy. The same shared
 * classifier that gates the edit form gates Create, so the UI structurally
 * cannot mint the inert (voice monitor, no game) triple.
 */
export function BindingCreateForm(props: BindingCreateFormProps) {
    const [open, setOpen] = useState(false);
    if (!open) {
        return <Button variant="secondary" onClick={() => setOpen(true)}>+ Add binding</Button>;
    }
    return <CreateBindingFields {...props} onClose={() => setOpen(false)} />;
}
