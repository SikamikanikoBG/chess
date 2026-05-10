import { Chess } from 'chess.js';
import type { Audience, Language, Classification } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coach prompt design (rewritten 2.1.0):
//
// Small LLMs hallucinate when asked to reason about chess. So we don't ask them
// to reason — we hand them a structured set of pre-computed FACTS (piece names,
// squares, captures, classification, engine recommendation, all derived from
// chess.js + the engine PV) and tell them to render those facts in prose.
//
// Rules baked into the system prompt:
//   1) Use only the facts. Never invent pieces, squares, threats, or moves.
//   2) Output natural language for moves: "the knight to f3", "the bishop
//      takes on e5". NEVER SAN like "Nf3" or "Bxe5".
//
// The board diagram is kept as a small sanity-check, not as the primary input.
// ─────────────────────────────────────────────────────────────────────────────

const PIECE_NAME_EN: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const PIECE_NAME_BG: Record<string, string> = { K: 'цар', Q: 'дама', R: 'топ', B: 'офицер', N: 'кон', P: 'пешка' };
const PIECE_NAME_KID_EN: Record<string, string> = { K: 'king', Q: 'queen', R: 'castle', B: 'bishop', N: 'horsey', P: 'pawn' };
const PIECE_NAME_KID_BG: Record<string, string> = { K: 'цар', Q: 'дама', R: 'топче', B: 'офицер', N: 'конче', P: 'пешка' };
const PIECE_VALUE: Record<string, number> = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1 };

function pieceNames(language: Language, audience: Audience): Record<string, string> {
  if (audience === 'kid') return language === 'bg' ? PIECE_NAME_KID_BG : PIECE_NAME_KID_EN;
  return language === 'bg' ? PIECE_NAME_BG : PIECE_NAME_EN;
}

const TONE: Record<Audience, Record<Language, string>> = {
  kid: {
    en: `You are a warm, patient chess coach for a 7–10 year old.
TONE: Simple words. Pieces are characters: the knight is a horsey, the rook is a castle, the queen is the strongest piece. Be encouraging — even a mistake is a learning chance.
LENGTH: 2–3 short sentences. No lists, no headings.`,
    bg: `Ти си мил и търпелив шах треньор за дете на 7–10 години.
ТОН: Прости думи. Фигурите са герои: конят е кончето, топът е топчето, дамата е най-силната. Бъди окуражителен — и грешката е урок.
ДЪЛЖИНА: 2–3 кратки изречения. Без списъци, без заглавия.`,
  },
  beginner: {
    en: `You are a friendly chess coach for a beginner.
STYLE: Plain language. When useful, mention a chess principle (king safety, piece development, control of the center, piece activity). Encourage when something is right.
LENGTH: 3–4 short sentences. No lists.`,
    bg: `Ти си приятелски шах треньор за начинаещ.
СТИЛ: Прост език. Когато е уместно, спомени принцип (безопасност на царя, развитие, контрол на центъра, активност на фигурите). Окуражавай при добър ход.
ДЪЛЖИНА: 3–4 кратки изречения. Без списъци.`,
  },
  intermediate: {
    en: `You are a chess coach for an intermediate player.
STYLE: Concrete reasoning. Standard chess concepts (pin, fork, weak square, outposts, pawn structure). Mention the principle behind the move.
LENGTH: 3–5 sentences. No lists.`,
    bg: `Ти си шах треньор за играч със средно ниво.
СТИЛ: Конкретни разсъждения. Стандартни понятия (пирон, вилица, слабо поле, аванпост, пешечна структура). Винаги спомени принципа.
ДЪЛЖИНА: 3–5 изречения. Без списъци.`,
  },
  advanced: {
    en: `You are a chess coach for an advanced club player.
STYLE: Discuss the positional theme, the key squares, the longer-term plan. Identify tactical motifs by name (pin, fork, deflection, discovered attack).
LENGTH: 3–6 sentences. No lists.`,
    bg: `Ти си шах треньор за напреднал клубен играч.
СТИЛ: Позиционна тема, ключови полета, дългосрочен план. Назовавай тактическите мотиви (пирон, вилица, отклонение, скрит удар).
ДЪЛЖИНА: 3–6 изречения. Без списъци.`,
  },
};

// Hard-rule block appended to every system prompt. It is the SAME for every
// audience because hallucination is universally bad.
const HARD_RULES_EN = `
HARD RULES — these come before everything else:
1. You are a RENDERER, not an analyst. Below the rules you will receive a list of FACTS already computed about this position. Do NOT add chess analysis the facts do not contain. Do NOT mention pieces, squares, threats, captures, or moves not present in the facts.
2. NEVER use chess notation like "Nf3", "Bxe5", "Qd1", "O-O" in your reply. Always say things in natural language: "the knight goes to f3", "the bishop takes on e5", "the queen drops back to d1", "short castles". Squares like d4, e5, f7 are fine on their own.
3. Begin directly. Do NOT start with "Sure", "Of course", "Let me explain", or repeat the question.
4. Speak in the second person to the player ("you played…").`;

const HARD_RULES_BG = `
ТВЪРДИ ПРАВИЛА — над всичко останало:
1. Ти си РЕНДЕРЕР, не анализатор. По-долу ще получиш списък с ФАКТИ, които вече са изчислени за тази позиция. Не добавяй анализ извън фактите. Не споменавай фигури, полета, заплахи, ходове, които не са във фактите.
2. НИКОГА не използвай шахматна нотация като "Кf3", "Оxe5", "Дd1", "0-0". Винаги говори на естествен език: "конят отива на f3", "офицерът взема на e5", "дамата се връща на d1", "къса рокада". Полета като d4, e5, f7 могат да се споменават.
3. Започвай директно. Не започвай с "Разбира се", "Нека ти обясня" или с повтаряне на въпроса.
4. Говори във второ лице на играча ("ти изигра…").`;

export function systemPrompt(audience: Audience, language: Language): string {
  return TONE[audience][language] + (language === 'bg' ? HARD_RULES_BG : HARD_RULES_EN);
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language move rendering
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a SAN move (in a given position) into "the knight takes on f7" prose. */
function sanToNatural(san: string, fenBefore: string, language: Language, audience: Audience): string {
  const names = pieceNames(language, audience);
  let res: ReturnType<Chess['move']> | null = null;
  try {
    const c = new Chess(fenBefore);
    res = c.move(san, { strict: false });
  } catch { /* fall through */ }
  if (!res) return san; // can't parse — fall back to SAN

  // Castling
  const flags = res.flags ?? '';
  if (flags.includes('k')) {
    return language === 'bg' ? 'къса рокада' : 'short castles';
  }
  if (flags.includes('q')) {
    return language === 'bg' ? 'дълга рокада' : 'long castles';
  }

  const piece = (res.piece || 'p').toUpperCase();
  const pieceName = names[piece] ?? names.P!;
  const captured = res.captured ? names[res.captured.toUpperCase()] : null;
  const isCheck = san.endsWith('+');
  const isMate = san.endsWith('#');
  const promo = res.promotion ? names[res.promotion.toUpperCase()] : null;

  let core: string;
  if (captured) {
    core = language === 'bg'
      ? `${pieceName} взема ${captured} на ${res.to}`
      : `the ${pieceName} takes the ${captured} on ${res.to}`;
  } else if (piece === 'P') {
    // Pawns read better as "pawn to e4"
    core = language === 'bg' ? `${pieceName} на ${res.to}` : `the ${pieceName} to ${res.to}`;
  } else {
    core = language === 'bg'
      ? `${pieceName} от ${res.from} на ${res.to}`
      : `the ${pieceName} from ${res.from} to ${res.to}`;
  }

  if (promo) {
    core += language === 'bg' ? `, повишена в ${promo}` : `, promoting to a ${promo}`;
  }

  if (isMate) core += language === 'bg' ? ' (мат)' : ' (checkmate)';
  else if (isCheck) core += language === 'bg' ? ' (шах)' : ' (check)';

  return core;
}

// ─────────────────────────────────────────────────────────────────────────────
// Board context (still useful as a sanity diagram)
// ─────────────────────────────────────────────────────────────────────────────

interface BoardContext {
  ascii: string;
  whiteInv: string;
  blackInv: string;
  turn: 'white' | 'black';
  inCheck: boolean;
  capturedByWhite: string;
  capturedByBlack: string;
  materialBalance: number;
}

function fenToBoardContext(fen: string, language: Language, audience: Audience): BoardContext {
  const parts = fen.split(' ');
  const board = parts[0] ?? '';
  const turn: 'white' | 'black' = parts[1] === 'w' ? 'white' : 'black';
  const names = pieceNames(language, audience);

  const rows = board.split('/');
  const ascii: string[] = [];
  const counts = { white: { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 } as Record<string, number>, black: { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 } as Record<string, number> };
  const inv: { white: Record<string, string[]>; black: Record<string, string[]> } = {
    white: { K: [], Q: [], R: [], B: [], N: [], P: [] },
    black: { K: [], Q: [], R: [], B: [], N: [], P: [] },
  };

  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let line = `${rank} | `;
    let file = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) { line += '. '; file++; }
      } else {
        line += ch + ' ';
        const sq = String.fromCharCode(97 + file) + rank;
        const piece = ch.toUpperCase();
        if (ch === ch.toUpperCase()) { counts.white[piece] = (counts.white[piece] ?? 0) + 1; inv.white[piece]?.push(sq); }
        else { counts.black[piece] = (counts.black[piece] ?? 0) + 1; inv.black[piece]?.push(sq); }
        file++;
      }
    }
    ascii.push(line.trimEnd());
  }
  ascii.push('    a b c d e f g h');

  function fmtInv(side: Record<string, string[]>): string {
    const order = ['K', 'Q', 'R', 'B', 'N', 'P'];
    const parts: string[] = [];
    for (const k of order) {
      const list = side[k];
      if (list && list.length > 0) parts.push(`${names[k]}: ${list.join(',')}`);
    }
    return parts.join(' | ') || '—';
  }

  const startCounts = { K: 1, Q: 1, R: 2, B: 2, N: 2, P: 8 };
  function capturedFrom(curr: Record<string, number>): { list: string; value: number } {
    const lost: string[] = [];
    let value = 0;
    for (const [k, n] of Object.entries(startCounts)) {
      const missing = n - (curr[k] ?? 0);
      if (missing > 0) {
        for (let i = 0; i < missing; i++) { lost.push(names[k]!); value += PIECE_VALUE[k] ?? 0; }
      }
    }
    return { list: lost.length ? lost.join(', ') : '—', value };
  }
  const blackTook = capturedFrom(counts.white);
  const whiteTook = capturedFrom(counts.black);

  let inCheck = false;
  try {
    const c = new Chess(fen);
    inCheck = c.isCheck();
  } catch { /* ignore */ }

  return {
    ascii: ascii.join('\n'),
    whiteInv: fmtInv(inv.white),
    blackInv: fmtInv(inv.black),
    turn,
    inCheck,
    capturedByWhite: whiteTook.list,
    capturedByBlack: blackTook.list,
    materialBalance: whiteTook.value - blackTook.value,
  };
}

export function fenToContext(fen: string, language: Language = 'en', audience: Audience = 'beginner'): string {
  const ctx = fenToBoardContext(fen, language, audience);
  const turnLabel = language === 'bg'
    ? (ctx.turn === 'white' ? 'Бели' : 'Черни')
    : (ctx.turn === 'white' ? 'White' : 'Black');
  const headers = language === 'bg'
    ? { whiteHdr: 'Бели фигури', blackHdr: 'Черни фигури', turnHdr: 'На ход', checkHdr: 'Шах', capW: 'Бели взеха', capB: 'Черни взеха', mat: 'Материален баланс' }
    : { whiteHdr: 'White pieces', blackHdr: 'Black pieces', turnHdr: 'To move', checkHdr: 'In check', capW: 'White has captured', capB: 'Black has captured', mat: 'Material balance' };
  const matSign = ctx.materialBalance > 0 ? `+${ctx.materialBalance}` : `${ctx.materialBalance}`;
  return [
    ctx.ascii,
    '',
    `${headers.whiteHdr}: ${ctx.whiteInv}`,
    `${headers.blackHdr}: ${ctx.blackInv}`,
    `${headers.capW}: ${ctx.capturedByWhite}`,
    `${headers.capB}: ${ctx.capturedByBlack}`,
    `${headers.mat}: ${matSign} (white perspective)`,
    `${headers.turnHdr}: ${turnLabel}${ctx.inCheck ? `  [${headers.checkHdr}]` : ''}`,
  ].join('\n');
}

// Recent move history in compact SAN — kept as background context.
export function recentMovesSan(history: string[], maxPlies = 8): string {
  if (!history.length) return '—';
  const start = Math.max(0, history.length - maxPlies);
  const slice = history.slice(start);
  const startMoveNum = Math.floor(start / 2) + 1;
  const startedOnBlack = (start % 2) === 1;
  const out: string[] = [];
  let n = startMoveNum;
  let i = 0;
  if (startedOnBlack) {
    out.push(`${n}...${slice[i]!}`);
    i++; n++;
  }
  while (i < slice.length) {
    const w = slice[i]; const b = slice[i + 1];
    out.push(`${n}.${w}${b ? ' ' + b : ''}`);
    i += 2; n++;
  }
  return out.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the FACTS the LLM has to render
// ─────────────────────────────────────────────────────────────────────────────

interface MoveContext {
  fen: string;
  player: 'White' | 'Black';
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  pv_san?: string[];
  history?: string[];
  user_perspective?: boolean;
}

const CLASS_PHRASE_EN: Record<Classification, string> = {
  brilliant: 'a brilliant move (the engine\'s top pick, and it sacrificed material)',
  great: 'a great move — the only move that kept the position',
  best: 'the engine\'s top choice — exactly the right move',
  excellent: 'an excellent move',
  good: 'a solid, good move',
  book: 'a known opening move from theory',
  forced: 'a forced move — this was the only legal move',
  inaccuracy: 'a small inaccuracy — there was a slightly better move',
  mistake: 'a mistake — a meaningfully better move was available',
  blunder: 'a blunder — this loses significant material or position',
  miss: 'a miss — you were winning, and a much stronger move was on the table',
};
const CLASS_PHRASE_BG: Record<Classification, string> = {
  brilliant: 'брилянтен ход (топ изборът на двигателя — и е жертва на материал)',
  great: 'страхотен ход — единственият, който държи позицията',
  best: 'топ изборът на двигателя — точно правилният ход',
  excellent: 'отличен ход',
  good: 'солиден, добър ход',
  book: 'известен теоретичен ход',
  forced: 'принуден ход — единственият легален ход',
  inaccuracy: 'малка неточност — имаше малко по-добър ход',
  mistake: 'грешка — имаше осезаемо по-добър ход',
  blunder: 'блъндер — този ход губи значителен материал или позиция',
  miss: 'пропуск — печелиш, а имаше много по-силен ход',
};

function severityFromCpLoss(cpLoss: number, language: Language): string {
  if (language === 'bg') {
    if (cpLoss < 15) return 'без загуба на оценка';
    if (cpLoss < 50) return 'дребна разлика в оценката';
    if (cpLoss < 100) return 'забележима загуба на оценка';
    if (cpLoss < 250) return 'голяма загуба на оценка';
    return 'тежка загуба на оценка';
  }
  if (cpLoss < 15) return 'no real loss in evaluation';
  if (cpLoss < 50) return 'a tiny dip in evaluation';
  if (cpLoss < 100) return 'a noticeable loss in evaluation';
  if (cpLoss < 250) return 'a large loss in evaluation';
  return 'a heavy loss in evaluation';
}

export function explainMovePrompt(ctx: MoveContext, language: Language, audience: Audience = 'beginner'): string {
  const board = fenToContext(ctx.fen, language, audience);
  const recent = recentMovesSan(ctx.history ?? [], 6);

  const playerLabel = ctx.user_perspective
    ? (language === 'bg' ? 'Ти' : 'You')
    : (language === 'bg' ? (ctx.player === 'White' ? 'Бели' : 'Черни') : ctx.player);

  const playedNatural = sanToNatural(ctx.played_san, ctx.fen, language, audience);
  const bestNatural = ctx.best_san && ctx.best_san !== ctx.played_san
    ? sanToNatural(ctx.best_san, ctx.fen, language, audience)
    : null;

  const classPhrase = (language === 'bg' ? CLASS_PHRASE_BG : CLASS_PHRASE_EN)[ctx.classification];
  const severity = severityFromCpLoss(ctx.cp_loss, language);

  // Convert PV (next few engine moves) into natural language by replaying it.
  let pvLine = '';
  if (ctx.pv_san && ctx.pv_san.length > 0) {
    const replay = new Chess(ctx.fen);
    const parts: string[] = [];
    for (const s of ctx.pv_san.slice(0, 4)) {
      const before = replay.fen();
      const phrase = sanToNatural(s, before, language, audience);
      try { replay.move(s, { strict: false }); } catch { break; }
      parts.push(phrase);
    }
    if (parts.length) {
      pvLine = language === 'bg'
        ? `\n- Възможно продължение според двигателя: ${parts.join('; след това ')}.`
        : `\n- Engine's expected continuation: ${parts.join('; then ')}.`;
    }
  }

  const headerEn = `Board (before the move):
${board}

Recent moves (for context only — do not invent extra ones): ${recent}

FACTS — render these in coach prose, do not add chess analysis beyond them:
- Player: ${playerLabel}
- What ${playerLabel} did: ${playedNatural}.
- ${bestNatural ? `Engine's best alternative was: ${bestNatural}.` : 'This was the engine\'s top choice.'}
- Engine verdict: ${classPhrase}.
- Magnitude: ${severity}.${pvLine}`;

  const headerBg = `Дъска (преди хода):
${board}

Последни ходове (само за контекст — не измисляй други): ${recent}

ФАКТИ — преведи ги в реч на треньор, без да добавяш свой анализ:
- Играч: ${playerLabel}
- Какво направи ${playerLabel}: ${playedNatural}.
- ${bestNatural ? `Препоръката на двигателя беше: ${bestNatural}.` : 'Това беше топ изборът на двигателя.'}
- Оценка от двигателя: ${classPhrase}.
- Размер: ${severity}.${pvLine}`;

  const askEn = ctx.user_perspective
    ? `\n\nWrite the explanation. Address the player directly ("you played…"). Use natural piece names ("knight", "bishop"), never SAN like "Nf3" or "Bxe5".`
    : `\n\nWrite the explanation in coach voice. Use natural piece names ("knight", "bishop"), never SAN like "Nf3" or "Bxe5".`;

  const askBg = ctx.user_perspective
    ? `\n\nНапиши обяснението. Говори на играча директно ("ти изигра…"). Използвай естествени имена ("кон", "офицер"), никога нотация като "Кf3".`
    : `\n\nНапиши обяснението с глас на треньор. Използвай естествени имена ("кон", "офицер"), никога нотация като "Кf3".`;

  return language === 'bg' ? headerBg + askBg : headerEn + askEn;
}

export function hintPrompt(fen: string, audience: Audience, language: Language, history: string[] = []): string {
  const board = fenToContext(fen, language, audience);
  const recent = recentMovesSan(history, 6);
  const recentLine = history.length
    ? (language === 'bg' ? `\nПоследни ходове (само за контекст): ${recent}` : `\nRecent moves (context only): ${recent}`)
    : '';

  if (language === 'bg') {
    return audience === 'kid'
      ? `Дъска:\n${board}${recentLine}\n\nДай малък намек какво да гледаме в позицията — НЕ казвай конкретен ход. Едно изречение. Естествен език, без нотация.`
      : `Дъска:\n${board}${recentLine}\n\nДай концептуален намек — тактически мотив, слабо поле, или общ план — БЕЗ да казваш конкретен ход. 1–2 изречения. Естествен език, без нотация.`;
  }
  return audience === 'kid'
    ? `Board:\n${board}${recentLine}\n\nGive a tiny hint about what to look at here — do NOT reveal a concrete move. One simple sentence. Use natural language, no chess notation.`
    : `Board:\n${board}${recentLine}\n\nGive a conceptual hint — a tactical motif, weak square, or general plan — do NOT reveal a concrete move. 1–2 sentences. Natural language only, no chess notation.`;
}
