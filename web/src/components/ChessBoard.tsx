import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key, Color } from 'chessground/types';
import { Chess } from 'chess.js';

interface Props {
  fen: string;
  orientation?: 'white' | 'black';
  movable?: boolean;
  turnColor?: Color;
  onMove?: (uci: string) => void;
  lastMove?: [Key, Key];
  highlightSquares?: Partial<Record<Key, string>>; // square -> color (e.g. for arrows/highlights)
  arrows?: { orig: Key; dest: Key; brush?: string }[];
  size?: number;
}

export default function ChessBoard({
  fen,
  orientation = 'white',
  movable = false,
  turnColor,
  onMove,
  lastMove,
  highlightSquares,
  arrows,
  size = 480,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<CgApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: movable
        ? {
            color: turnColor,
            free: false,
            dests: legalDests(fen),
            showDests: true,
            events: {
              after: (orig, dest) => {
                const promotion = needsPromotion(fen, orig, dest) ? 'q' : '';
                onMove?.(orig + dest + promotion);
              },
            },
          }
        : { free: false },
      drawable: { enabled: true, defaultSnapToValidMove: true },
    };
    apiRef.current = Chessground(ref.current, config);
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update on prop changes
  useEffect(() => {
    if (!apiRef.current) return;
    apiRef.current.set({
      fen,
      orientation,
      turnColor,
      lastMove,
      movable: movable
        ? {
            color: turnColor,
            free: false,
            dests: legalDests(fen),
            showDests: true,
          }
        : { free: false },
    });
    if (arrows && arrows.length) {
      apiRef.current.setShapes(arrows.map((a) => ({ orig: a.orig, dest: a.dest, brush: a.brush ?? 'green' })));
    } else {
      apiRef.current.setShapes([]);
    }
    if (highlightSquares) {
      const squares: { orig: Key; brush: string }[] = [];
      for (const [sq, color] of Object.entries(highlightSquares)) {
        squares.push({ orig: sq as Key, brush: color });
      }
    }
  }, [fen, orientation, turnColor, lastMove, movable, arrows, highlightSquares]);

  return <div ref={ref} style={{ width: size, height: size }} />;
}

function legalDests(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen);
  const map = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const arr = map.get(m.from as Key) ?? [];
    arr.push(m.to as Key);
    map.set(m.from as Key, arr);
  }
  return map;
}

function needsPromotion(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  // chess.js Square excludes "a0"; chessground Key includes it. Cast safely.
  const piece = chess.get(from as never);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1');
}
