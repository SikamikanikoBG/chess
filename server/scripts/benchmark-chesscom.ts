// Compare our analyzer against chess.com's reported accuracy on real games.
//
// Run with:  npx tsx server/scripts/benchmark-chesscom.ts [depth]
// Reads:     server/scripts/benchmark-games.json
// Writes:    server/scripts/benchmark-report.md (and prints progress)
//
// Each PGN is fed to analyzePgnFull (the same code that powers /api/analyze).
// We compare per-side accuracy and report MAE / sign of bias. Classification
// counts and our Elo estimate are reported per-game; chess.com doesn't expose
// either via the public API, so they're informational only.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzePgnFull } from '../src/routes/analyze.js';

interface GameRef {
  url: string;
  time_class: string;
  time_control: string | null;
  end_time: number;
  white_username: string;
  black_username: string;
  white_rating: number;
  black_rating: number;
  white_result: string;
  black_result: string;
  ref_accuracy_white: number;
  ref_accuracy_black: number;
  plies: number;
  pgn: string;
}

interface RowOut {
  url: string;
  white: string;
  black: string;
  plies: number;
  ref_w: number;
  ref_b: number;
  ours_w: number;
  ours_b: number;
  delta_w: number;
  delta_b: number;
  elo_w: number | null;
  elo_b: number | null;
  classification_counts: Record<string, number>;
  elapsed_s: number;
  opening: string | null;
}

function scoreFor(side: 'white' | 'black', whiteResult: string): 0 | 0.5 | 1 | null {
  if (whiteResult === 'win') return side === 'white' ? 1 : 0;
  if (whiteResult === 'checkmated' || whiteResult === 'resigned' ||
      whiteResult === 'timeout' || whiteResult === 'abandoned' ||
      whiteResult === 'lose') {
    return side === 'white' ? 0 : 1;
  }
  if (whiteResult === 'agreed' || whiteResult === 'stalemate' ||
      whiteResult === 'repetition' || whiteResult === 'insufficient' ||
      whiteResult === '50move' || whiteResult === 'timevsinsufficient') {
    return 0.5;
  }
  return null;
}

async function main() {
  const depth = Number(process.argv[2] ?? 16);
  const inputName = process.argv[3] ?? 'benchmark-games.json';
  const outputName = process.argv[4] ?? 'benchmark-report.md';
  const inputPath = resolve(import.meta.dirname, inputName);
  const outputPath = resolve(import.meta.dirname, outputName);

  const games = JSON.parse(readFileSync(inputPath, 'utf8')) as GameRef[];
  console.log(`Loaded ${games.length} games. Depth=${depth}.\n`);

  const rows: RowOut[] = [];
  const t0 = Date.now();

  for (let i = 0; i < games.length; i++) {
    const g = games[i]!;
    const tag = `[${i + 1}/${games.length}]`;
    console.log(`${tag} ${g.white_username} vs ${g.black_username}  (${g.plies} plies, ref W=${g.ref_accuracy_white} B=${g.ref_accuracy_black})`);
    const tStart = Date.now();

    // Run from white's perspective so performance_white is filled with the
    // proper score/opponent_rating context. (We don't use the perf number;
    // it's just to keep the analyze code path identical to production.)
    let res;
    try {
      res = await analyzePgnFull(g.pgn, depth, {
        score: scoreFor('white', g.white_result),
        userColor: 'white',
        opponentRating: g.black_rating,
        opponentRd: null,
      });
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
      continue;
    }
    const elapsed_s = (Date.now() - tStart) / 1000;

    const counts: Record<string, number> = {};
    for (const m of res.moves) counts[m.classification] = (counts[m.classification] ?? 0) + 1;

    const row: RowOut = {
      url: g.url,
      white: g.white_username,
      black: g.black_username,
      plies: g.plies,
      ref_w: g.ref_accuracy_white,
      ref_b: g.ref_accuracy_black,
      ours_w: res.accuracy_white,
      ours_b: res.accuracy_black,
      delta_w: +(res.accuracy_white - g.ref_accuracy_white).toFixed(2),
      delta_b: +(res.accuracy_black - g.ref_accuracy_black).toFixed(2),
      elo_w: res.estimated_elo_white,
      elo_b: res.estimated_elo_black,
      classification_counts: counts,
      elapsed_s: +elapsed_s.toFixed(1),
      opening: res.opening_name ?? null,
    };
    rows.push(row);

    console.log(`    ours  W=${row.ours_w}  B=${row.ours_b}   delta W=${row.delta_w >= 0 ? '+' : ''}${row.delta_w}  B=${row.delta_b >= 0 ? '+' : ''}${row.delta_b}   elo W=${row.elo_w} B=${row.elo_b}   ${elapsed_s.toFixed(0)}s`);
    console.log(`    counts: ${JSON.stringify(counts)}`);
    console.log(`    opening: ${row.opening ?? '-'}\n`);
  }

  // Aggregate stats. MAE is the headline number; bias tells us if we
  // systematically read accuracy higher or lower than chess.com.
  const deltas = rows.flatMap((r) => [r.delta_w, r.delta_b]);
  const mae = deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
  const bias = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const max = deltas.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  const within3 = deltas.filter((d) => Math.abs(d) <= 3).length / deltas.length;
  const within5 = deltas.filter((d) => Math.abs(d) <= 5).length / deltas.length;

  let md = '';
  md += `# chess.com accuracy benchmark\n\n`;
  md += `- Source: Hikaru April 2026 archive (10 games, all blitz, 37–59 plies)\n`;
  md += `- Our depth: ${depth}, Stockfish 17, MultiPV=3\n`;
  md += `- Run completed in ${((Date.now() - t0) / 60_000).toFixed(1)} min\n`;
  md += `- Scoring version: see SCORING_VERSION in classifier.ts\n\n`;
  md += `## Summary\n\n`;
  md += `| metric | value |\n|---|---|\n`;
  md += `| games | ${rows.length} |\n`;
  md += `| accuracy data points (sides × games) | ${deltas.length} |\n`;
  md += `| **MAE vs chess.com** | **${mae.toFixed(2)}** |\n`;
  md += `| mean signed bias (ours − ref) | ${bias >= 0 ? '+' : ''}${bias.toFixed(2)} |\n`;
  md += `| max absolute delta | ${max.toFixed(2)} |\n`;
  md += `| within ±3 pts | ${(within3 * 100).toFixed(0)}% |\n`;
  md += `| within ±5 pts | ${(within5 * 100).toFixed(0)}% |\n\n`;
  md += `## Per-game\n\n`;
  md += `| # | game | plies | side | ref | ours | Δ | our Elo | counts |\n`;
  md += `|---|---|---:|---|---:|---:|---:|---:|---|\n`;
  rows.forEach((r, i) => {
    const idx = i + 1;
    const countStr = Object.entries(r.classification_counts)
      .map(([k, v]) => `${k.slice(0, 4)}:${v}`).join(' ');
    md += `| ${idx} | [${r.white} vs ${r.black}](${r.url}) | ${r.plies} | W | ${r.ref_w} | ${r.ours_w} | ${r.delta_w >= 0 ? '+' : ''}${r.delta_w} | ${r.elo_w ?? '-'} | ${countStr} |\n`;
    md += `| | | | B | ${r.ref_b} | ${r.ours_b} | ${r.delta_b >= 0 ? '+' : ''}${r.delta_b} | ${r.elo_b ?? '-'} | |\n`;
  });

  writeFileSync(outputPath, md);
  console.log(`\nReport written to ${outputPath}`);
  console.log(`MAE=${mae.toFixed(2)}  bias=${bias.toFixed(2)}  max=${max.toFixed(2)}  within±3=${(within3 * 100).toFixed(0)}%  within±5=${(within5 * 100).toFixed(0)}%`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
