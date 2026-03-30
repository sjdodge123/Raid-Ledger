/**
 * SVG donut progress ring showing member count vs threshold (ROK-989).
 * Uses stroke-dasharray/stroke-dashoffset for the arc fill.
 */
import type { JSX } from 'react';

interface MatchProgressRingProps {
  current: number;
  target: number;
  size?: number;
  color?: string;
}

/** Calculate geometry values for the ring. */
function ringGeometry(size: number, strokeWidth: number) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  return { radius, circumference, center };
}

/** Calculate the stroke offset for a percentage fill. */
function computeOffset(circumference: number, current: number, target: number): number {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return circumference - (pct / 100) * circumference;
}

/** SVG ring arcs (background + fill). */
function RingArcs({ size, color, circumference, offset, radius, center }: {
  size: number; color: string; circumference: number;
  offset: number; radius: number; center: number;
}): JSX.Element {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-zinc-700" />
      <circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`} />
    </svg>
  );
}

/** Circular progress ring with count label in the center. */
export function MatchProgressRing({
  current, target, size = 48, color = '#22c55e',
}: MatchProgressRingProps): JSX.Element {
  const { radius, circumference, center } = ringGeometry(size, 3);
  const offset = computeOffset(circumference, current, target);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <RingArcs size={size} color={color} circumference={circumference} offset={offset} radius={radius} center={center} />
      <span className="absolute text-[10px] font-bold text-foreground">{current}</span>
    </div>
  );
}
