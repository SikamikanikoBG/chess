// Per-game written Game Review — chess.com Game Report parity.
// Composes Stockfish analysis + ECO + key moments + AI prose into a single
// structured document. Each LLM call is small (< 1.5k tokens) so weak local
// models (gemma2:2b, qwen2.5:7b) reliably hold the JSON schema.
//
// Pipeline (all calls are batched through the orchestrator below; emit
// `progress` events as each step finishes so the UI can render a stepper):
//   1. opening_lookup       — local, instant
//   2. phase:opening prose  — Ollama JSON
//   3. phase:middlegame     — Ollama JSON
//   4. phase:endgame        — Ollama JSON
//   5. moment:i for each    — Ollama JSON (3–5 calls)
//   6. summary              — Ollama JSON (skill_assessment + summary + opening_prose)
//
// Output is cached in `analyses.prose_json`, keyed by (scoring_version,
// prose_version, language, audience). Re-runs only when one of those changes.

import { Chess } from 'chess.js';
import { chatJsonRetry, type ChatMessage } from './ollama.js';
import { systemPrompt } from './prompts.js';
import type { AnalysisResult, AnalyzedMove, Audience, Classification, GamePhase, KeyMomentSummary, Language } from '../types.js';

export const REVIEW_PROSE_VERSION = 1;

// Hard rules append-on for every JSON-mode call. Keeps the small models honest.
const JSON_HARD_EN = `\n\nHARD RULES — these come before everything else:
1. Reply ONLY with a single JSON object that matches the schema below. No prose outside the JSON. No markdown fences.
2. Every "prose" / "summary" / "title" string must be in the requested language.
3. Address the player as "you" (or "ти") when the player is the human user.
4. NEVER use chess notation like "Nf3", "Bxe5". Always use natural language: "the knight to f3", "the bishop takes on e5". Square names like d4 e5 are fine.
5. Be concrete and specific. Avoid generic chess platitudes.`;

const JSON_HARD_BG = `\n\nТВЪРДИ ПРАВИЛА — над всичко останало:
1. Отговори САМО с един JSON обект, който съответства на схемата. Без текст извън JSON. Без markdown.
2. Всяко "prose" / "summary" / "title" поле да е на исканият език.
3. Обръщай се към играча с "ти", когато играчът е човек.
4. НИКОГА не използвай нотация (Кf3, Оxe5). Винаги естествен език: "конят на f3", "офицерът взема на e5". Полетата (d4, e5) могат.
5. Бъди конкретен и точен. Избягвай шаблонни шахматни фрази.`;

export interface PhaseProse {
  from_ply: number;
  to_ply: number;
  accuracy: number;
  acpl: number;
  prose: string;
}

export interface KeyMomentProse extends KeyMomentSummary {
  title: string;
  prose: string;
}

export interface GameReview {
  version: number;
  language: Language;
  audience: Audience;
  opening: { eco: string; name: string; prose: string } | null;
  summary: string;
  skill_assessment: string;
  phases: { opening: PhaseProse | null; middlegame: PhaseProse | null; endgame: PhaseProse | null };
  key_moments: KeyMomentProse[];
}

export type ProgressEvent =
  | { step: 'opening' | 'phase:opening' | 'phase:middlegame' | 'phase:endgame' | 'summary'; done: number; total: number }
  | { step: 'moment'; index: number; done: number; total: number };

export interface BuildReviewArgs {
  pgn: string;
  analysis: AnalysisResult;
  language: Language;
  audience: Audience;
  userColor: 'white' | 'black';
  onProgress?: (ev: ProgressEvent) => void;
  signal?: AbortSignal;
}

const CLASS_PHRASE_EN: Record<Classification, string> = {
  brilliant: 'a brilliant move (engine top pick + sacrifice)',
  great: 'a great move — only move that held the position',
  best: 'engine top choice',
  excellent: 'an excellent move',
  good: 'a solid move',
  book: 'a known opening / theory move',
  forced: 'a forced move (only legal option)',
  inaccuracy: 'a small inaccuracy',
  mistake: 'a mistake — a meaningfully better move was available',
  blunder: 'a blunder — significant material or position lost',
  miss: 'a missed win — a much stronger move was on the table',
};
const CLASS_PHRASE_BG: Record<Classification, string> = {
  brilliant: 'брилянтен ход (топ избор + жертва)',
  great: 'страхотен ход — единственият, който държи позицията',
  best: 'топ изборът на двигателя',
  excellent: 'отличен ход',
  good: 'солиден ход',
  book: 'теоретичен ход',
  forced: 'принуден ход (единственият легален)',
  inaccuracy: 'малка неточност',
  mistake: 'грешка — имаше осезаемо по-добър ход',
  blunder: 'блъндер — губи значително',
  miss: 'пропуск — печелиш, имаше много по-силен ход',
};

function totalSteps(args: BuildReviewArgs): number {
  let n = 1; // opening lookup
  if (args.analysis.phase_split?.opening) n++;
  if (args.analysis.phase_split?.middlegame) n++;
  if (args.analysis.phase_split?.endgame) n++;
  n += args.analysis.key_moments.length;
  n += 1; // summary
  return n;
}

function pieceNatural(san: string, fenBefore: string): string {
  // Replays through chess.js to get piece + from + to, returns english natural
  // language. Used as facts for the LLM. (BG callers translate via prompts.)
  try {
    const c = new Chess(fenBefore);
    const m = c.move(san, { strict: false });
    if (!m) return san;
    const flags = m.flags ?? '';
    if (flags.includes('k')) return 'short castles';
    if (flags.includes('q')) return 'long castles';
    const piece = (m.piece || 'p').toUpperCase();
    const names: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
    const captured = m.captured ? names[m.captured.toUpperCase()] : null;
    if (captured) return `the ${names[piece]} takes the ${captured} on ${m.to}`;
    if (piece === 'P') return `the pawn to ${m.to}`;
    return `the ${names[piece]} from ${m.from} to ${m.to}`;
  } catch {
    return san;
  }
}

function pvNatural(pvSan: string[], fromFen: string, max = 4): string[] {
  if (!pvSan.length) return [];
  const replay = new Chess(fromFen);
  const out: string[] = [];
  for (const s of pvSan.slice(0, max)) {
    const before = replay.fen();
    const phrase = pieceNatural(s, before);
    try { replay.move(s, { strict: false }); } catch { break; }
    out.push(phrase);
  }
  return out;
}

async function callPhase(
  phase: GamePhase,
  data: { from_ply: number; to_ply: number; accuracy_white: number; accuracy_black: number; acpl_white: number; acpl_black: number },
  moves: AnalyzedMove[],
  language: Language,
  audience: Audience,
  userColor: 'white' | 'black',
  signal?: AbortSignal,
): Promise<PhaseProse> {
  const userAcc = userColor === 'white' ? data.accuracy_white : data.accuracy_black;
  const userAcpl = userColor === 'white' ? data.acpl_white : data.acpl_black;
  const phaseLabel = language === 'bg'
    ? (phase === 'opening' ? 'дебют' : phase === 'middlegame' ? 'миттелшпил' : 'ендшпил')
    : phase;
  const slice = moves.filter((m) => m.ply >= data.from_ply && m.ply <= data.to_ply);
  // Compact list of *interesting* moves only, capped to 8 lines so the prompt
  // doesn't swamp the small model.
  const lines = slice
    .filter((m) => m.classification !== 'best' && m.classification !== 'excellent' && m.classification !== 'good' && m.classification !== 'book' && m.classification !== 'forced')
    .slice(0, 8)
    .map((m) => {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      return `- ply ${m.ply} (${side}): ${m.san}, ${m.classification}, cp_loss=${m.centipawn_loss}`;
    })
    .join('\n') || (language === 'bg' ? 'Без отбелязани грешки.' : 'No flagged mistakes.');

  const sys = systemPrompt(audience, language) + (language === 'bg' ? JSON_HARD_BG : JSON_HARD_EN);
  const usr = language === 'bg'
    ? `Опиши фазата "${phaseLabel}" в 2–3 изречения. ФАКТИ:\n- Точност (твоята): ${userAcc}%\n- Среден cpLoss: ${userAcpl}\n- Брой ходове: ${slice.length}\n${lines}\n\nСхема: { "prose": "string (2-3 изречения, за играча с 'ти')" }`
    : `Describe the "${phase}" phase in 2-3 sentences for the player. FACTS:\n- Your accuracy: ${userAcc}%\n- Avg cp loss: ${userAcpl}\n- Plies in phase: ${slice.length}\n${lines}\n\nSchema: { "prose": "string (2-3 sentences, address the player as 'you')" }`;

  try {
    const result = await chatJsonRetry<{ prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ], { temperature: 0.2, numPredict: 350, signal });
    const prose = (result.prose ?? '').trim() || fallbackPhase(phase, userAcc, slice.length, language);
    return { from_ply: data.from_ply, to_ply: data.to_ply, accuracy: userAcc, acpl: userAcpl, prose };
  } catch {
    return { from_ply: data.from_ply, to_ply: data.to_ply, accuracy: userAcc, acpl: userAcpl, prose: fallbackPhase(phase, userAcc, slice.length, language) };
  }
}

function fallbackPhase(phase: GamePhase, accuracy: number, plies: number, language: Language): string {
  if (language === 'bg') {
    return `В ${phase === 'opening' ? 'дебюта' : phase === 'middlegame' ? 'миттелшпила' : 'ендшпила'} точността ти беше ${accuracy.toFixed(1)}% за ${plies} полу-хода.`;
  }
  return `Your ${phase} accuracy was ${accuracy.toFixed(1)}% across ${plies} plies.`;
}

async function callKeyMoment(
  moment: KeyMomentSummary,
  language: Language,
  audience: Audience,
  signal?: AbortSignal,
): Promise<KeyMomentProse> {
  const playedNat = pieceNatural(moment.san, moment.fen_before);
  const bestNat = moment.best_san ? pieceNatural(moment.best_san, moment.fen_before) : null;
  const pvLine = pvNatural(moment.best_pv, moment.fen_before, 3);
  const classPhrase = (language === 'bg' ? CLASS_PHRASE_BG : CLASS_PHRASE_EN)[moment.classification];

  const sys = systemPrompt(audience, language) + (language === 'bg' ? JSON_HARD_BG : JSON_HARD_EN);
  const usr = language === 'bg'
    ? `Един ключов момент от партията. ФАКТИ (преведи ги в обяснение, не добавяй свой анализ):\n- Ход: ${playedNat}\n- Препоръка: ${bestNat ?? 'същият ход'}\n- Оценка: ${classPhrase}\n- Загуба: ${moment.cp_loss} cp; промяна на печеливщ %: ${moment.win_pct_delta.toFixed(1)}\n${pvLine.length ? `- Препоръчано продължение: ${pvLine.join('; след това ')}` : ''}\n\nСхема: { "title": "string ≤6 думи", "prose": "string (3-4 изречения)" }`
    : `One key moment from the game. FACTS (render to coach prose, do NOT invent extras):\n- Played: ${playedNat}\n- Engine's preferred: ${bestNat ?? 'same move'}\n- Verdict: ${classPhrase}\n- Loss: ${moment.cp_loss} cp; win-pct swing: ${moment.win_pct_delta.toFixed(1)}\n${pvLine.length ? `- Engine's continuation: ${pvLine.join('; then ')}` : ''}\n\nSchema: { "title": "string ≤6 words", "prose": "string (3-4 sentences)" }`;

  try {
    const result = await chatJsonRetry<{ title?: string; prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ], { temperature: 0.2, numPredict: 300, signal });
    return {
      ...moment,
      title: (result.title ?? '').trim() || (language === 'bg' ? 'Ключов момент' : 'Key moment'),
      prose: (result.prose ?? '').trim() || fallbackMoment(moment, language),
    };
  } catch {
    return { ...moment, title: language === 'bg' ? 'Ключов момент' : 'Key moment', prose: fallbackMoment(moment, language) };
  }
}

function fallbackMoment(m: KeyMomentSummary, language: Language): string {
  const cls = (language === 'bg' ? CLASS_PHRASE_BG : CLASS_PHRASE_EN)[m.classification];
  if (language === 'bg') {
    return `На полу-ход ${m.ply} играта се обърна. ${cls}. Загубата беше около ${m.cp_loss} стотни от пешка.`;
  }
  return `On ply ${m.ply} the game turned. ${cls}. The cost was about ${m.cp_loss} centipawns.`;
}

async function callSummary(
  analysis: AnalysisResult,
  userColor: 'white' | 'black',
  language: Language,
  audience: Audience,
  signal?: AbortSignal,
): Promise<{ summary: string; skill_assessment: string; opening_prose: string }> {
  const userAcc = userColor === 'white' ? analysis.accuracy_white : analysis.accuracy_black;
  const oppAcc = userColor === 'white' ? analysis.accuracy_black : analysis.accuracy_white;
  const userElo = userColor === 'white' ? analysis.estimated_elo_white : analysis.estimated_elo_black;
  const userPerf = userColor === 'white' ? analysis.performance_white : analysis.performance_black;
  const counts = { brilliant: 0, great: 0, mistake: 0, blunder: 0, miss: 0 };
  for (const m of analysis.moves) {
    const side = m.ply % 2 === 1 ? 'white' : 'black';
    if (side !== userColor) continue;
    if (m.classification in counts) (counts as Record<string, number>)[m.classification]++;
  }
  const sys = systemPrompt(audience, language) + (language === 'bg' ? JSON_HARD_BG : JSON_HARD_EN);
  const usr = language === 'bg'
    ? `Резюме на партията за играча. ФАКТИ:\n- Точност (твоя): ${userAcc}%; на противника: ${oppAcc}%\n- Оценен Elo за партията: ${userElo ?? '—'}; пърформанс: ${userPerf ?? '—'}\n- Брилянтни: ${counts.brilliant}; страхотни: ${counts.great}; грешки: ${counts.mistake}; пропуски: ${counts.miss}; блъндери: ${counts.blunder}\n- Дебют: ${analysis.opening_name ?? '—'}${analysis.opening_eco ? ` (${analysis.opening_eco})` : ''}\n\nСхема: { "summary": "string (3-4 изречения, обърни се с 'ти')", "skill_assessment": "string (1 изречение за нивото)", "opening_prose": "string (≤2 изречения за дебюта)" }`
    : `Summarize the game for the player. FACTS:\n- Your accuracy: ${userAcc}%; opponent's: ${oppAcc}%\n- Estimated Elo for this game: ${userElo ?? '—'}; performance: ${userPerf ?? '—'}\n- Brilliant: ${counts.brilliant}; Great: ${counts.great}; Mistakes: ${counts.mistake}; Misses: ${counts.miss}; Blunders: ${counts.blunder}\n- Opening: ${analysis.opening_name ?? '—'}${analysis.opening_eco ? ` (${analysis.opening_eco})` : ''}\n\nSchema: { "summary": "string (3-4 sentences, address as 'you')", "skill_assessment": "string (1 sentence on the skill)", "opening_prose": "string (≤2 sentences about the opening)" }`;

  try {
    const result = await chatJsonRetry<{ summary?: string; skill_assessment?: string; opening_prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ], { temperature: 0.2, numPredict: 400, signal });
    return {
      summary: (result.summary ?? '').trim() || fallbackSummary(userAcc, counts, language),
      skill_assessment: (result.skill_assessment ?? '').trim() || fallbackSkill(userElo, language),
      opening_prose: (result.opening_prose ?? '').trim() || (analysis.opening_name ? fallbackOpening(analysis.opening_name, language) : ''),
    };
  } catch {
    return {
      summary: fallbackSummary(userAcc, counts, language),
      skill_assessment: fallbackSkill(userElo, language),
      opening_prose: analysis.opening_name ? fallbackOpening(analysis.opening_name, language) : '',
    };
  }
}

function fallbackSummary(acc: number, counts: { brilliant: number; great: number; mistake: number; blunder: number; miss: number }, language: Language): string {
  if (language === 'bg') {
    return `Точността ти беше ${acc.toFixed(1)}%. Имаше ${counts.brilliant} брилянтни, ${counts.mistake} грешки и ${counts.blunder} блъндера.`;
  }
  return `Your accuracy was ${acc.toFixed(1)}%. You had ${counts.brilliant} brilliant moves, ${counts.mistake} mistakes, and ${counts.blunder} blunders.`;
}
function fallbackSkill(elo: number | null, language: Language): string {
  if (elo == null) return language === 'bg' ? 'Все още нямаме оценка на нивото.' : 'No skill estimate yet.';
  return language === 'bg' ? `Партията ти изглежда на ниво около ${elo} Elo.` : `This game played at roughly ${elo} Elo.`;
}
function fallbackOpening(name: string, language: Language): string {
  return language === 'bg' ? `Започна с ${name} — солиден избор.` : `You opened with ${name} — a solid choice.`;
}

/** Build the full Game Review. Emits onProgress events as steps complete. */
export async function buildGameReview(args: BuildReviewArgs): Promise<GameReview> {
  const total = totalSteps(args);
  let done = 0;
  const fire = (step: ProgressEvent['step'], extra?: Partial<ProgressEvent>) => {
    args.onProgress?.({ step, done, total, ...(extra as object) } as ProgressEvent);
  };

  // Step 1: opening (already in analysis — local lookup)
  done++;
  fire('opening' as ProgressEvent['step']);

  const phases: GameReview['phases'] = { opening: null, middlegame: null, endgame: null };
  const phaseSplit = args.analysis.phase_split;
  if (phaseSplit?.opening) {
    phases.opening = await callPhase('opening', phaseSplit.opening, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:opening');
  }
  if (phaseSplit?.middlegame) {
    phases.middlegame = await callPhase('middlegame', phaseSplit.middlegame, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:middlegame');
  }
  if (phaseSplit?.endgame) {
    phases.endgame = await callPhase('endgame', phaseSplit.endgame, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:endgame');
  }

  const key_moments: KeyMomentProse[] = [];
  for (let i = 0; i < args.analysis.key_moments.length; i++) {
    const m = args.analysis.key_moments[i]!;
    const km = await callKeyMoment(m, args.language, args.audience, args.signal);
    key_moments.push(km);
    done++;
    args.onProgress?.({ step: 'moment', index: i, done, total });
  }

  const final = await callSummary(args.analysis, args.userColor, args.language, args.audience, args.signal);
  done++; fire('summary');

  return {
    version: REVIEW_PROSE_VERSION,
    language: args.language,
    audience: args.audience,
    opening: args.analysis.opening_name && args.analysis.opening_eco
      ? { eco: args.analysis.opening_eco, name: args.analysis.opening_name, prose: final.opening_prose }
      : null,
    summary: final.summary,
    skill_assessment: final.skill_assessment,
    phases,
    key_moments,
  };
}

/** Lightweight signature so callers can validate cached prose still matches the
 *  current language/audience/version before re-using it. */
export function reviewCacheKey(args: { language: Language; audience: Audience }): string {
  return `${REVIEW_PROSE_VERSION}|${args.language}|${args.audience}`;
}
