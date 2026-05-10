// SVG accuracy donut. Color-grades by score so the ring instantly conveys
// "good game / mediocre / rough" without the user reading the number.
//
//   ≥ 90 → cyan-brilliant (#1baca6)
//   80–90 → emerald-best (#81b64c)
//   70–80 → gold-inaccuracy (#f7c045)
//   < 70 → orange-mistake (#ffa459)

interface Props {
  /** Accuracy 0..100. */
  value: number | null | undefined;
  /** Outer SVG size in pixels. Inner ring is ~12px thinner. */
  size?: number;
  label?: string;
}

function colorForAccuracy(v: number): string {
  if (v >= 90) return '#1baca6';
  if (v >= 80) return '#81b64c';
  if (v >= 70) return '#f7c045';
  return '#ffa459';
}

export default function AccuracyDonut({ value, size = 80, label }: Props) {
  const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const ringColor = v == null ? '#a09a93' : colorForAccuracy(v);
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const filled = v == null ? 0 : (v / 100) * c;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `Accuracy ${v ?? '—'}%`}>
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(160,154,147,0.25)" strokeWidth={10} fill="none" />
        {/* Filled arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={ringColor}
          strokeWidth={10}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${filled} ${c - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%" y="50%"
          textAnchor="middle" dominantBaseline="central"
          fontSize={size * 0.30}
          fontWeight={700}
          fontFamily='"Roboto Mono", ui-monospace, monospace'
          fill="currentColor"
        >
          {v == null ? '—' : v.toFixed(1)}
        </text>
      </svg>
      {label && <div className="mt-1 text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>}
    </div>
  );
}
