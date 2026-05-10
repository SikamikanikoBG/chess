export type Role = 'admin' | 'user';
export type Language = 'en' | 'bg';
export type Audience = 'kid' | 'beginner' | 'intermediate' | 'advanced';
export type CoachBehavior = 'silent' | 'on_demand' | 'always_on_pedagogical';
export type Difficulty = 'kid' | 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'stockfish';
export type Color = 'white' | 'black';
export type Classification = 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'blunder';

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

export interface AnalysisResult {
  depth: number;
  moves: AnalyzedMove[];
  accuracy_white: number;
  accuracy_black: number;
}
