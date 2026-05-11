// Run inside the patzer container against the compiled dist (no TS).
// Usage:  node /tmp/bench/benchmark-chesscom.mjs [depth=16]
// Reads:  /tmp/bench/benchmark-games.json   (10 chess.com games with reference accuracies)
// Writes: /tmp/bench/benchmark-report.md    (markdown comparison) and prints progress.
//
// Imports analyzePgnFull from the container's compiled JS so we exercise the
// exact code path that powers /api/analyze in production.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANALYZE_PATH = '/app/server/dist/routes/analyze.js';
const INPUT_PATH = '/tmp/bench/benchmark-games.json';
const OUTPUT_PATH = '/tmp/bench/benchmark-report.md';

const { analyzePgnFull } = await import(pathToFileURL(ANALYZE_PATH).href);

function scoreFor(side, whiteResult) {
  if (whiteResult === 'win') return side === 'white' ? 1 : 0;
  if (['checkmated', 'resigned', 'timeout', 'abandoned', 'lose'].includes(whiteResult)) {
    return side === 'white' ? 0 : 1;
  }
  if (['agreed', 'stalemate', 'repetition', 'insufficient', '50move', 'timevsinsufficient'].includes(whiteResult)) {
    return 0.5;
  }
  return null;
}

const depth = Number(process.argv[2] ?? 16);
const games = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
console.log(`Loaded ${games.length} games. Depth=${depth}.\n`);

const rows = [];
const t0 = Date.now();

for (let i = 0; i < games.length; i++) {
  const g = games[i];
  const tag = `[${i + 1}/${games.length}]`;
  console.log(`${tag} ${g.white_username} vs ${g.black_username}  (${g.plies} plies, ref W=${g.ref_accuracy_white} B=${g.ref_accuracy_black})`);
  const tStart = Date.now();

  let res;
  try {
    res = await analyzePgnFull(g.pgn, depth, {
      score: scoreFor('white', g.white_result),
      userColor: 'white',
      opponentRating: g.black_rating,
      opponentRd: null,
    });
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    continue;
  }
  const elapsed_s = (Date.now() - tStart) / 1000;

  const counts = {};
  for (const m of res.moves) counts[m.classification] = (counts[m.classification] ?? 0) + 1;

  const row = {
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

  const fmt = (n) => (n >= 0 ? '+' : '') + n;
  console.log(`    ours  W=${row.ours_w}  B=${row.ours_b}   delta W=${fmt(row.delta_w)}  B=${fmt(row.delta_b)}   elo W=${row.elo_w} B=${row.elo_b}   ${elapsed_s.toFixed(0)}s`);
  console.log(`    counts: ${JSON.stringify(counts)}`);
  console.log(`    opening: ${row.opening ?? '-'}\n`);
}

const deltas = rows.flatMap((r) => [r.delta_w, r.delta_b]);
const mae = deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
const bias = deltas.reduce((a, b) => a + b, 0) / deltas.length;
const max = deltas.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
const within3 = deltas.filter((d) => Math.abs(d) <= 3).length / deltas.length;
const within5 = deltas.filter((d) => Math.abs(d) <= 5).length / deltas.length;

let md = '';
md += `# chess.com accuracy benchmark\n\n`;
md += `- Source: Hikaru April 2026 archive (10 games, all blitz, 37–59 plies)\n`;
md += `- Our depth: ${depth}, Stockfish, MultiPV=3 (container default threads/hash)\n`;
md += `- Run completed in ${((Date.now() - t0) / 60_000).toFixed(1)} min\n\n`;
md += `## Summary\n\n`;
md += `| metric | value |\n|---|---|\n`;
md += `| games | ${rows.length} |\n`;
md += `| data points (sides × games) | ${deltas.length} |\n`;
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

writeFileSync(OUTPUT_PATH, md);
console.log(`\nReport written to ${OUTPUT_PATH}`);
console.log(`MAE=${mae.toFixed(2)}  bias=${bias.toFixed(2)}  max=${max.toFixed(2)}  within±3=${(within3 * 100).toFixed(0)}%  within±5=${(within5 * 100).toFixed(0)}%`);
process.exit(0);
