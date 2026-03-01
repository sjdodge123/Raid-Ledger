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

/**
 * VoiceRoster — Real-time voice channel participant list (ROK-293, ROK-530).
 * Used for both ad-hoc and planned events. Shows active/left participants
 * with join time and duration.
 */
export function VoiceRoster({ participants, activeCount }: VoiceRosterProps) {
  const active = participants.filter((p) => !p.leftAt);
  const left = participants.filter((p) => !!p.leftAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Voice Channel Roster
        </h3>
        <span className="text-xs text-muted">
          {activeCount} active / {participants.length} total
        </span>
      </div>

      {/* Active Participants */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide">
            In Channel ({active.length})
          </p>
          <div className="space-y-1">
            {active.map((p) => (
              <ParticipantRow key={p.id} participant={p} isActive={true} />
            ))}
          </div>
        </div>
      )}

      {/* Left Participants */}
      {left.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">
            Left ({left.length})
          </p>
          <div className="space-y-1">
            {left.map((p) => (
              <ParticipantRow key={p.id} participant={p} isActive={false} />
            ))}
          </div>
        </div>
      )}

      {participants.length === 0 && (
        <p className="text-sm text-muted text-center py-4">
          No participants yet
        </p>
      )}
    </div>
  );
}

function ParticipantRow({
  participant,
  isActive,
}: {
  participant: AdHocParticipantDto;
  isActive: boolean;
}) {
  const joinTime = new Date(participant.joinedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg ${
        isActive ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-overlay/50'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Avatar */}
        {participant.discordAvatarHash ? (
          <img
            src={`https://cdn.discordapp.com/avatars/${participant.discordUserId}/${participant.discordAvatarHash}.png?size=32`}
            alt=""
            className="w-6 h-6 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-dim flex-shrink-0 flex items-center justify-center text-xs text-muted">
            {participant.discordUsername.charAt(0).toUpperCase()}
          </div>
        )}

        <span
          className={`text-sm truncate ${
            isActive ? 'text-foreground' : 'text-muted'
          }`}
        >
          {participant.discordUsername}
          {!participant.userId && (
            <span className="text-xs text-dim ml-1">(guest)</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted flex-shrink-0">
        <span>joined {joinTime}</span>
        {participant.totalDurationSeconds !== null && (
          <span>{formatDuration(participant.totalDurationSeconds)}</span>
        )}
        {isActive && (
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
        )}
      </div>
    </div>
  );
}
