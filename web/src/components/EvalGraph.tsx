import { LineChart, Line, ResponsiveContainer, ReferenceLine, Tooltip, YAxis, XAxis } from 'recharts';

interface Props {
  evals: Array<{ ply: number; cp: number | null }>; // white-perspective centipawns
  current?: number;
  onClick?: (ply: number) => void;
}

export default function EvalGraph({ evals, current, onClick }: Props) {
  const data = evals.map((e) => ({
    ply: e.ply,
    move: Math.ceil(e.ply / 2) + (e.ply % 2 === 1 ? '. ' : '… '),
    eval: clampCp(e.cp ?? 0),
  }));

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          onClick={(e) => {
            if (e?.activePayload?.[0]?.payload?.ply) onClick?.(e.activePayload[0].payload.ply);
          }}
        >
          <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
          {current !== undefined && (
            <ReferenceLine x={current} stroke="#10b981" strokeDasharray="2 2" />
          )}
          <YAxis hide domain={[-1000, 1000]} />
          <XAxis dataKey="ply" hide />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.92)', border: 'none', borderRadius: 8, color: '#f8fafc', fontSize: 12 }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v: number) => formatCp(v)}
            labelFormatter={(_, p) => p?.[0]?.payload?.move ?? ''}
          />
          <Line type="monotone" dataKey="eval" stroke="#0e1320" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function clampCp(cp: number): number {
  return Math.max(-1000, Math.min(1000, cp));
}

function formatCp(cp: number): string {
  if (Math.abs(cp) >= 9000) return cp > 0 ? '#' : '-#';
  const sign = cp >= 0 ? '+' : '';
  return `${sign}${(cp / 100).toFixed(2)}`;
}
