export type Role = 'admin' | 'user';
export type Language = 'en' | 'bg';
export type Audience = 'kid' | 'beginner' | 'intermediate' | 'advanced';
export type CoachBehavior = 'silent' | 'on_demand' | 'always_on_pedagogical';
export type Difficulty = 'kid' | 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'stockfish';
export type Color = 'white' | 'black';
export type Classification = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced' | 'inaccuracy' | 'mistake' | 'blunder' | 'miss';

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface Profile {
  user_id: number;
  display_name: string;
  avatar_emoji: string;
  language: Language;
  audience: Audience;
  chesscom_username: string | null;
  coach_behavior: CoachBehavior;
  tts_enabled: number;
  tts_voice: string | null;
  tts_rate: number;
  tts_pitch: number;
  board_theme: string;
  piece_set: string;
}

export interface AuthedUser extends User {
  profile: Profile;
}

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

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface PhaseSplit {
  opening: { from_ply: number; to_ply: number; accuracy_white: number; accuracy_black: number; acpl_white: number; acpl_black: number } | null;
  middlegame: { from_ply: number; to_ply: number; accuracy_white: number; accuracy_black: number; acpl_white: number; acpl_black: number } | null;
  endgame: { from_ply: number; to_ply: number; accuracy_white: number; accuracy_black: number; acpl_white: number; acpl_black: number } | null;
}

export interface KeyMomentSummary {
  ply: number;
  side: 'white' | 'black';
  san: string;
  fen_before: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number;
  best_san: string | null;
  best_pv: string[];
}

export interface AnalysisResult {
  depth: number;
  moves: AnalyzedMove[];
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  // v4.0.0 additions
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  key_moments: KeyMomentSummary[];
  phase_split: PhaseSplit | null;
}
