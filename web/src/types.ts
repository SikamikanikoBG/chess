export type Classification = 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'blunder';

export type Difficulty = 'kid' | 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'stockfish';

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  best_move_uci: string | null;
  best_move_san: string | null;
  best_pv: string[];
  centipawn_loss: number;
  classification: Classification;
}

export interface AnalysisResult {
  depth: number;
  moves: AnalyzedMove[];
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
}

export interface GameRow {
  id: number;
  source: 'chesscom' | 'played' | 'imported';
  external_id: string | null;
  white: string;
  black: string;
  result: string;
  time_control: string;
  end_time: string;
  user_color: 'white' | 'black' | null;
  analyzed: number;
  accuracy_white: number | null;
  accuracy_black: number | null;
}
