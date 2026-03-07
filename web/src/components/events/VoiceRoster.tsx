import type { AdHocParticipantDto } from '@raid-ledger/contract';

interface VoiceRosterProps {
  participants: AdHocParticipantDto[];
  activeCount: number;
}

/**
 * Format seconds into a human-readable duration string.
 */
function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 60) return '<1m';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function ParticipantAvatar({ participant }: { participant: AdHocParticipantDto }) {
  if (participant.discordAvatarHash) {
    return (
      <img
        src={`https://cdn.discordapp.com/avatars/${participant.discordUserId}/${participant.discordAvatarHash}.png?size=32`}
        alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
    );
  }
  return (
    <div className="w-6 h-6 rounded-full bg-dim flex-shrink-0 flex items-center justify-center text-xs text-muted">
      {participant.discordUsername.charAt(0).toUpperCase()}
    </div>
  );
}

function ParticipantName({ participant, isActive }: { participant: AdHocParticipantDto; isActive: boolean }) {
  return (
    <span className={`text-sm truncate ${isActive ? 'text-foreground' : 'text-muted'}`}>
      {participant.discordUsername}
      {!participant.userId && <span className="text-xs text-dim ml-1">(guest)</span>}
    </span>
  );
}

function ParticipantMeta({ participant, isActive }: { participant: AdHocParticipantDto; isActive: boolean }) {
  const joinTime = new Date(participant.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-center gap-3 text-xs text-muted flex-shrink-0">
      <span>joined {joinTime}</span>
      {participant.totalDurationSeconds !== null && <span>{formatDuration(participant.totalDurationSeconds)}</span>}
      {isActive && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
    </div>
  );
}

function ParticipantRow({ participant, isActive }: { participant: AdHocParticipantDto; isActive: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
      isActive ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-overlay/50'
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        <ParticipantAvatar participant={participant} />
        <ParticipantName participant={participant} isActive={isActive} />
      </div>
      <ParticipantMeta participant={participant} isActive={isActive} />
    </div>
  );
}

function ParticipantGroup({ participants, isActive, label, count }: {
  participants: AdHocParticipantDto[]; isActive: boolean; label: string; count: number;
}) {
  if (participants.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className={`text-xs font-medium uppercase tracking-wide ${isActive ? 'text-emerald-400' : 'text-muted'}`}>
        {label} ({count})
      </p>
      <div className="space-y-1">
        {participants.map((p) => <ParticipantRow key={p.id} participant={p} isActive={isActive} />)}
      </div>
    </div>
  );
}

/**
 * VoiceRoster — Real-time voice channel participant list (ROK-293, ROK-530).
 */
export function VoiceRoster({ participants, activeCount }: VoiceRosterProps) {
  const active = participants.filter((p) => !p.leftAt);
  const left = participants.filter((p) => !!p.leftAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Voice Channel Roster</h3>
        <span className="text-xs text-muted">{activeCount} active / {participants.length} total</span>
      </div>
      <ParticipantGroup participants={active} isActive={true} label="In Channel" count={active.length} />
      <ParticipantGroup participants={left} isActive={false} label="Left" count={left.length} />
      {participants.length === 0 && <p className="text-sm text-muted text-center py-4">No participants yet</p>}
    </div>
  );
}
