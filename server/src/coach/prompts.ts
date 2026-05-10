import type { Audience, Language, Classification } from '../types.js';

const TONE: Record<Audience, Record<Language, string>> = {
  kid: {
    en: 'You are a warm, patient chess coach for a 7-10 year old child. Use very simple words, short sentences, and friendly encouragement. Compare pieces to characters when it helps. Never use chess jargon without explaining it. Use 2-4 short sentences total.',
    bg: 'Ти си мил и търпелив шах треньор за дете на 7-10 години. Използвай много прости думи, кратки изречения и приятелско окуражение. Сравнявай фигурите с герои, когато помага. Никога не използвай шах термини без да ги обясниш. Общо 2-4 кратки изречения.',
  },
  beginner: {
    en: 'You are a friendly chess coach for a beginner. Explain in plain language. Briefly mention the principle behind a move (king safety, piece activity, controlling the center, etc.). 3-5 sentences max.',
    bg: 'Ти си приятелски настроен шах треньор за начинаещ. Обяснявай на прост език. Накратко спомени принципа зад хода (безопасност на царя, активност на фигурите, контрол на центъра и т.н.). Максимум 3-5 изречения.',
  },
  intermediate: {
    en: 'You are a chess coach. Explain moves with concrete tactical and strategic reasoning. Use standard chess terminology. 3-5 sentences.',
    bg: 'Ти си шах треньор. Обяснявай ходовете с конкретни тактически и стратегически разсъждения. Използвай стандартна шах терминология. 3-5 изречения.',
  },
  advanced: {
    en: 'You are a chess coach for an advanced club player. Discuss positional themes, candidate moves, key squares, and longer-term plans. Be precise and concise. 3-6 sentences.',
    bg: 'Ти си шах треньор за напреднал клубен играч. Обсъждай позиционни теми, кандидат ходове, ключови полета и дългосрочни планове. Бъди точен и стегнат. 3-6 изречения.',
  },
};

export function systemPrompt(audience: Audience, language: Language): string {
  return TONE[audience][language];
}

interface MoveContext {
  fen: string;
  player: 'White' | 'Black';
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  pv_san?: string[];
}

export function explainMovePrompt(ctx: MoveContext, language: Language): string {
  const head = language === 'bg'
    ? `Позиция (FEN): ${ctx.fen}\n${ctx.player} играе ${ctx.played_san}.`
    : `Position (FEN): ${ctx.fen}\n${ctx.player} played ${ctx.played_san}.`;

  const best = ctx.best_san && ctx.best_san !== ctx.played_san
    ? (language === 'bg'
        ? `Двигателят препоръчва ${ctx.best_san}.`
        : `The engine recommends ${ctx.best_san}.`)
    : (language === 'bg'
        ? `Това е най-добрият ход според двигателя.`
        : `This is the engine's top choice.`);

  const klass = (() => {
    const map: Record<Classification, [string, string]> = {
      best: ['best move', 'най-добър ход'],
      excellent: ['excellent', 'отличен ход'],
      good: ['good', 'добър ход'],
      book: ['book move', 'теоретичен ход'],
      inaccuracy: ['an inaccuracy', 'неточност'],
      mistake: ['a mistake', 'грешка'],
      blunder: ['a blunder', 'голяма грешка (блъндер)'],
    };
    const [en, bg] = map[ctx.classification];
    return language === 'bg'
      ? `Този ход е оценен като ${bg} (загуба ${ctx.cp_loss} стотни от пешка).`
      : `This move is classified as ${en} (cp loss ${ctx.cp_loss}).`;
  })();

  const pv = ctx.pv_san && ctx.pv_san.length
    ? (language === 'bg'
        ? `\nПредложен вариант: ${ctx.pv_san.slice(0, 6).join(' ')}`
        : `\nSuggested line: ${ctx.pv_san.slice(0, 6).join(' ')}`)
    : '';

  const ask = language === 'bg'
    ? `\n\nОбясни ясно защо ходът е такъв, какво се пропуска или какво се постига. Започни директно с обяснението, без да повтаряш позицията.`
    : `\n\nExplain clearly why this is the case — what was missed or achieved. Jump straight into the explanation; don't repeat the position.`;

  return `${head}\n${best}\n${klass}${pv}${ask}`;
}

export function hintPrompt(fen: string, audience: Audience, language: Language): string {
  if (language === 'bg') {
    return audience === 'kid'
      ? `Това е позицията (FEN): ${fen}\n\nДай ми много малък намек какво да търся, без да ми казваш конкретен ход. Само една изречение, простичко.`
      : `Това е позицията (FEN): ${fen}\n\nДай ми концептуален намек какво да търся (тактически мотив, слабо поле, и т.н.) без да казваш конкретен ход. Едно-две изречения.`;
  }
  return audience === 'kid'
    ? `Position (FEN): ${fen}\n\nGive me a tiny hint about what to look for — don't tell me a move. Just one simple sentence.`
    : `Position (FEN): ${fen}\n\nGive me a conceptual hint about what to look for (a tactical motif, a weak square, etc.) — don't reveal a concrete move. One or two sentences.`;
}
