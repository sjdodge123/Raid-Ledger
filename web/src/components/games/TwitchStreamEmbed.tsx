import { useState } from 'react';
import type { TwitchStreamDto } from '@raid-ledger/contract';

interface TwitchStreamEmbedProps {
    streams: TwitchStreamDto[];
    totalLive: number;
}

function StreamHeader({ totalLive }: { totalLive: number }) {
    return (
        <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-lg font-semibold text-foreground">Live on Twitch</h3>
            <span className="text-muted text-sm">({totalLive} stream{totalLive !== 1 ? 's' : ''})</span>
        </div>
    );
}

function StreamInfo({ stream }: { stream: TwitchStreamDto }) {
    return (
        <>
            <div className="flex items-center gap-3">
                <span className="font-medium text-foreground">{stream.userName}</span>
                <span className="text-muted text-sm flex items-center gap-1">
                    <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
                    {stream.viewerCount.toLocaleString()} viewers
                </span>
            </div>
            <p className="text-sm text-secondary line-clamp-1">{stream.title}</p>
        </>
    );
}

function StreamThumbnail({ stream, isActive, onClick }: { stream: TwitchStreamDto; isActive: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} className={`relative rounded-lg overflow-hidden text-left transition-all ${isActive ? 'ring-2 ring-emerald-500' : 'hover:ring-1 hover:ring-edge'}`}>
            <img src={stream.thumbnailUrl} alt={stream.title} className="w-full aspect-video object-cover" loading="lazy" />
            <div className="p-2 bg-panel">
                <p className="text-xs font-medium text-foreground truncate">{stream.userName}</p>
                <p className="text-[10px] text-muted">{stream.viewerCount.toLocaleString()} viewers</p>
            </div>
        </button>
    );
}

export function TwitchStreamEmbed({ streams, totalLive }: TwitchStreamEmbedProps) {
    const [activeStream, setActiveStream] = useState(0);
    if (streams.length === 0) return null;
    const currentStream = streams[activeStream];
    const parentHost = window.location.hostname;

    return (
        <div className="space-y-4">
            <StreamHeader totalLive={totalLive} />
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
                <iframe src={`https://player.twitch.tv/?channel=${encodeURIComponent(currentStream.userName)}&parent=${parentHost}`} className="w-full h-full" allowFullScreen title={`${currentStream.userName}'s stream`} />
            </div>
            <StreamInfo stream={currentStream} />
            {streams.length > 1 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                    {streams.map((stream, i) => <StreamThumbnail key={stream.userName} stream={stream} isActive={i === activeStream} onClick={() => setActiveStream(i)} />)}
                </div>
            )}
        </div>
    );
}
