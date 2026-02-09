import './integration-hub.css';

interface OrbitRingProps {
    /** Ring label (AUTH, GAMING, COMMS) */
    label: string;
    /** Ring radius in pixels */
    radius: number;
    /** Ring index (0=inner, 1=middle, 2=outer) */
    ringIndex: number;
    /** Child nodes to position on the ring */
    children?: React.ReactNode;
}

/**
 * OrbitRing component (ROK-195)
 * Renders a single orbital ellipse track with rotating nodes
 */
export function OrbitRing({ label, radius, ringIndex, children }: OrbitRingProps) {
    // Ring colors based on index
    const ringColors = [
        'rgba(16, 185, 129, 0.6)', // AUTH - emerald
        'rgba(20, 184, 166, 0.5)',  // GAMING - teal
        'rgba(139, 92, 246, 0.4)',  // COMMS - purple
    ];

    const ringColor = ringColors[ringIndex] || ringColors[0];

    return (
        <div
            className="orbit-ring"
            style={{
                '--orbit-radius': `${radius}px`,
                '--ring-color': ringColor,
            } as React.CSSProperties}
        >
            {/* Ring track (ellipse) */}
            <div className="orbit-ring__track" />

            {/* Ring label */}
            <div className="orbit-ring__label">{label}</div>

            {/* Rotating container for nodes */}
            <div className="orbit-ring__rotation">
                {children}
            </div>
        </div>
    );
}
