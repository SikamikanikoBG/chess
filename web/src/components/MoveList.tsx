import MoveRow from './MoveRow';

interface Move { ply: number; san: string; classification?: string }

interface Props {
  moves: Move[];
  current: number;
  onSelect: (ply: number) => void;
  /** Optional pixel cap; defaults to 420. */
  maxHeight?: number;
}

// Two-column move-pair-per-row list. The badge sits to the right of each SAN,
// the current half-move is highlighted, and the row's left edge is tinted by
// the worst classification in the pair (matching chess.com Game Review).
export default function MoveList({ moves, current, onSelect, maxHeight = 420 }: Props) {
  const rows: { num: number; white?: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ num: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  return (
    <div
      className="overflow-auto rounded-xl border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-800/60"
      style={{ maxHeight }}
    >
      <div className="sticky top-0 z-10 grid grid-cols-[2.25rem_1fr_1fr] border-b border-ink-200 bg-ink-50 px-0 py-1 text-[10px] uppercase tracking-wide text-ink-500 dark:border-ink-700 dark:bg-ink-900/60">
        <div />
        <div className="px-2">White</div>
        <div className="px-2">Black</div>
      </div>
      {rows.map((r) => (
        <MoveRow
          key={r.num}
          num={r.num}
          white={r.white}
          black={r.black}
          current={current}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
