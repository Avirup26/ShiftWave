'use client';

import { useEffect, useState } from 'react';

// Gauge geometry constants
const SIZE = 140;
const STROKE = 13;
const R = 54;
const CX = 70;
const CY = 70;
const CIRC = 2 * Math.PI * R; // ≈ 339.3

export interface GaugeSegment {
  /** Fraction of the full ring, 0–1. */
  proportion: number;
  /** CSS color string (hex or named). */
  color: string;
  /** Text shown in the dot legend below the ring. */
  legendLabel: string;
}

interface RadialGaugeProps {
  title: string;
  segments: GaugeSegment[];
  /** Large number / percentage shown in the center. */
  centerValue: string;
  /** Smaller label beneath the center value. */
  centerSub: string;
  /** Full description for aria-label on the SVG. */
  ariaLabel: string;
  /** Optional status badge shown beside the title. */
  badge?: { label: string; color: 'red' | 'amber' | 'green' | 'zinc' };
}

const badgeCls = {
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  zinc: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

/**
 * Animated radial (ring) gauge.
 *
 * Each segment is drawn using the stroke-dasharray / dashoffset technique:
 *   dasharray  = "CIRC CIRC"   (single dash the circumference long, gap equally long)
 *   dashoffset = CIRC*(1−p)    → shows p·CIRC of the arc from the rotation anchor
 *
 * On mount the dashoffset transitions from CIRC (nothing) to CIRC*(1−p) (full arc),
 * producing a smooth fill animation starting from 12 o'clock.
 */
export default function RadialGauge({
  title,
  segments,
  centerValue,
  centerSub,
  ariaLabel,
  badge,
}: RadialGaugeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One rAF delay so the browser registers the initial (empty) state before
    // transitioning to the filled state, giving us the draw-on animation.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isMulti = segments.length > 1;
  let cumProportion = 0;

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-black/10 bg-white px-5 py-4 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-950 dark:hover:border-zinc-700">
      {/* Title row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </p>
        {badge && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeCls[badge.color]}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* Ring + center label */}
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-label={ariaLabel}
          role="img"
          overflow="visible"
        >
          {/* Track (background ring) */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            stroke="currentColor"
            className="text-zinc-100 dark:text-zinc-800"
          />

          {/* Animated progress segments */}
          {segments.map((seg, i) => {
            // Angle in degrees where this segment starts (−90 = 12 o'clock).
            const startDeg = cumProportion * 360 - 90;
            cumProportion += seg.proportion;

            // dashoffset: CIRC when empty (pre-mount) → CIRC*(1−p) when filled.
            const dashoffset = mounted ? CIRC * (1 - seg.proportion) : CIRC;

            return (
              <circle
                key={i}
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={STROKE}
                // Round caps for single-segment gauges; butt for multi-segment
                // so adjacent arcs meet cleanly.
                strokeLinecap={isMulti ? 'butt' : 'round'}
                // dash = CIRC (full-circle dash), gap = CIRC (full-circle gap)
                // → only seg.proportion of the ring is ever visible.
                strokeDasharray={`${CIRC} ${CIRC}`}
                strokeDashoffset={dashoffset}
                // Rotate so this segment begins at startDeg.
                transform={`rotate(${startDeg}, ${CX}, ${CY})`}
                style={{
                  transition: `stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1) ${i * 0.18}s`,
                }}
              />
            );
          })}
        </svg>

        {/* Center text — overlaid via absolute positioning */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums leading-none text-zinc-900 dark:text-zinc-100">
            {centerValue}
          </span>
          <span className="mt-1.5 max-w-[84px] text-center text-[10px] leading-tight text-zinc-400 dark:text-zinc-500">
            {centerSub}
          </span>
        </div>
      </div>

      {/* Dot legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{seg.legendLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
