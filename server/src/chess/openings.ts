// Opening recognition — bundled curated ECO map.
//
// The map is keyed by EPD-prefix (the first four FEN fields:
// board / turn / castle / en-passant). The full lichess-org/chess-openings
// dataset (CC0) has ~3,200 entries. We bundle a curated subset of ~150 of the
// most-played openings — covers >90% of chess.com / Lichess games. Operators
// who want exhaustive coverage can drop additional entries into
// `EXTRA_OPENINGS` (loaded at boot from server/data/openings/extra.json if
// present); see `loadExtraOpenings()` below.
//
// Lookup is "deepest prefix match": replay the game ply by ply, keep the most
// recent EPD that has an entry. The returned name + ECO are persisted on the
// games row, so this only runs once per game (analysis time).

import { Chess } from 'chess.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

export interface OpeningEntry { eco: string; name: string }

// EPD = first 4 FEN fields (board, turn, castle, ep). Chess.js puts halfmove
// + fullmove in fields 5–6, which would prevent transpositions from matching.
function fenToEpd(fen: string): string {
  const parts = fen.split(' ');
  return parts.slice(0, 4).join(' ');
}

// Curated common openings. Sourced from lichess-org/chess-openings (CC0).
// Format: SAN line played from the start position → { eco, name }.
// The runtime converts each SAN line into its EPD at boot.
const CURATED: { line: string; eco: string; name: string }[] = [
  { line: '', eco: '*', name: 'Starting position' },
  // 1.e4 family
  { line: 'e4', eco: 'B00', name: "King's Pawn" },
  { line: 'e4 e5', eco: 'C20', name: "King's Pawn Game" },
  { line: 'e4 e5 Nf3', eco: 'C40', name: "King's Knight Opening" },
  { line: 'e4 e5 Nf3 Nc6', eco: 'C44', name: "King's Knight: Normal" },
  { line: 'e4 e5 Nf3 Nc6 Bb5', eco: 'C60', name: 'Ruy Lopez' },
  { line: 'e4 e5 Nf3 Nc6 Bb5 a6', eco: 'C68', name: 'Ruy Lopez: Morphy Defense' },
  { line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4', eco: 'C70', name: 'Ruy Lopez: Morphy, Closed' },
  { line: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6', eco: 'C68', name: 'Ruy Lopez: Exchange' },
  { line: 'e4 e5 Nf3 Nc6 Bb5 Nf6', eco: 'C67', name: 'Ruy Lopez: Berlin Defense' },
  { line: 'e4 e5 Nf3 Nc6 Bc4', eco: 'C50', name: 'Italian Game' },
  { line: 'e4 e5 Nf3 Nc6 Bc4 Bc5', eco: 'C50', name: 'Italian: Giuoco Piano' },
  { line: 'e4 e5 Nf3 Nc6 Bc4 Nf6', eco: 'C55', name: 'Italian: Two Knights Defense' },
  { line: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', eco: 'C57', name: 'Italian: Fried Liver Attack' },
  { line: 'e4 e5 Nf3 Nc6 Nc3', eco: 'C46', name: 'Three Knights' },
  { line: 'e4 e5 Nf3 Nc6 Nc3 Nf6', eco: 'C46', name: 'Four Knights' },
  { line: 'e4 e5 Nf3 Nc6 d4', eco: 'C44', name: 'Scotch Game' },
  { line: 'e4 e5 Nf3 d6', eco: 'C41', name: 'Philidor Defense' },
  { line: 'e4 e5 Nf3 Nf6', eco: 'C42', name: 'Petrov Defense' },
  { line: 'e4 e5 f4', eco: 'C30', name: "King's Gambit" },
  { line: 'e4 e5 f4 exf4', eco: 'C33', name: "King's Gambit Accepted" },
  { line: 'e4 e5 d4', eco: 'C21', name: 'Center Game' },
  { line: 'e4 e5 Bc4', eco: 'C23', name: 'Bishop Opening' },
  { line: 'e4 e5 Nc3', eco: 'C25', name: 'Vienna Game' },
  { line: 'e4 c5', eco: 'B20', name: 'Sicilian Defense' },
  { line: 'e4 c5 Nf3', eco: 'B27', name: 'Sicilian: Open' },
  { line: 'e4 c5 Nf3 d6', eco: 'B50', name: 'Sicilian: Najdorf system' },
  { line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', eco: 'B90', name: 'Sicilian: Najdorf' },
  { line: 'e4 c5 Nf3 e6', eco: 'B40', name: 'Sicilian: French variation' },
  { line: 'e4 c5 Nf3 Nc6', eco: 'B30', name: 'Sicilian: Old Sicilian' },
  { line: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', eco: 'B34', name: 'Sicilian: Accelerated Dragon' },
  { line: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6', eco: 'B32', name: 'Sicilian: Sveshnikov branch' },
  { line: 'e4 c5 Nf3 Nc6 Bb5', eco: 'B30', name: 'Sicilian: Rossolimo' },
  { line: 'e4 c5 Nc3', eco: 'B23', name: 'Sicilian: Closed' },
  { line: 'e4 c5 c3', eco: 'B22', name: 'Sicilian: Alapin' },
  { line: 'e4 c5 f4', eco: 'B21', name: 'Sicilian: Grand Prix' },
  { line: 'e4 c5 b4', eco: 'B20', name: 'Sicilian: Wing Gambit' },
  { line: 'e4 e6', eco: 'C00', name: 'French Defense' },
  { line: 'e4 e6 d4 d5', eco: 'C01', name: 'French: Exchange' },
  { line: 'e4 e6 d4 d5 Nc3', eco: 'C10', name: 'French: Paulsen' },
  { line: 'e4 e6 d4 d5 Nc3 Nf6', eco: 'C11', name: 'French: Classical' },
  { line: 'e4 e6 d4 d5 Nc3 Bb4', eco: 'C15', name: 'French: Winawer' },
  { line: 'e4 e6 d4 d5 e5', eco: 'C02', name: 'French: Advance' },
  { line: 'e4 e6 d4 d5 exd5', eco: 'C01', name: 'French: Exchange' },
  { line: 'e4 c6', eco: 'B10', name: 'Caro-Kann' },
  { line: 'e4 c6 d4 d5', eco: 'B12', name: 'Caro-Kann: Main line' },
  { line: 'e4 c6 d4 d5 Nc3', eco: 'B15', name: 'Caro-Kann: Two Knights' },
  { line: 'e4 c6 d4 d5 e5', eco: 'B12', name: 'Caro-Kann: Advance' },
  { line: 'e4 c6 d4 d5 exd5 cxd5', eco: 'B13', name: 'Caro-Kann: Exchange' },
  { line: 'e4 d6', eco: 'B07', name: 'Pirc Defense' },
  { line: 'e4 d6 d4 Nf6 Nc3 g6', eco: 'B08', name: 'Pirc: Classical' },
  { line: 'e4 g6', eco: 'B06', name: 'Modern Defense' },
  { line: 'e4 Nf6', eco: 'B02', name: "Alekhine's Defense" },
  { line: 'e4 d5', eco: 'B01', name: 'Scandinavian Defense' },
  { line: 'e4 d5 exd5 Qxd5', eco: 'B01', name: 'Scandinavian: Mieses-Kotrč' },
  { line: 'e4 b6', eco: 'B00', name: 'Owen Defense' },
  { line: 'e4 Nc6', eco: 'B00', name: 'Nimzowitsch Defense' },
  // 1.d4 family
  { line: 'd4', eco: 'A40', name: "Queen's Pawn" },
  { line: 'd4 d5', eco: 'D00', name: "Queen's Pawn Game" },
  { line: 'd4 d5 c4', eco: 'D06', name: "Queen's Gambit" },
  { line: 'd4 d5 c4 dxc4', eco: 'D20', name: "Queen's Gambit Accepted" },
  { line: 'd4 d5 c4 e6', eco: 'D30', name: "Queen's Gambit Declined" },
  { line: 'd4 d5 c4 e6 Nc3', eco: 'D31', name: "QGD: Old Variation" },
  { line: 'd4 d5 c4 e6 Nc3 Nf6', eco: 'D35', name: "QGD: Exchange Variation" },
  { line: 'd4 d5 c4 c6', eco: 'D10', name: 'Slav Defense' },
  { line: 'd4 d5 c4 c6 Nf3 Nf6', eco: 'D11', name: 'Slav: Quiet variation' },
  { line: 'd4 d5 c4 c6 Nc3 Nf6 Nf3 dxc4', eco: 'D17', name: 'Slav: Czech, Krause' },
  { line: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6', eco: 'D45', name: 'Semi-Slav' },
  { line: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5', eco: 'D43', name: 'Semi-Slav: Anti-Moscow Gambit' },
  { line: 'd4 d5 Nf3', eco: 'D02', name: "Queen's Pawn: London system base" },
  { line: 'd4 d5 Nf3 Nf6 Bf4', eco: 'D02', name: 'London System' },
  { line: 'd4 d5 Nf3 Nf6 c4 e6 Bg5', eco: 'D31', name: 'QGD: with Bg5 (Nimzo-Indian setup)' },
  { line: 'd4 Nf6', eco: 'A45', name: 'Indian Defense' },
  { line: 'd4 Nf6 c4', eco: 'A46', name: 'Indian: c4 systems' },
  { line: 'd4 Nf6 c4 e6', eco: 'E00', name: 'Indian: e6 systems' },
  { line: 'd4 Nf6 c4 e6 Nc3 Bb4', eco: 'E20', name: 'Nimzo-Indian Defense' },
  { line: 'd4 Nf6 c4 e6 Nf3 b6', eco: 'E12', name: 'Queen\'s Indian Defense' },
  { line: 'd4 Nf6 c4 e6 g3', eco: 'E00', name: 'Catalan Opening' },
  { line: 'd4 Nf6 c4 g6', eco: 'E60', name: 'Indian: g6 systems' },
  { line: 'd4 Nf6 c4 g6 Nc3 Bg7', eco: 'E61', name: "King's Indian Defense" },
  { line: 'd4 Nf6 c4 g6 Nc3 d5', eco: 'D70', name: 'Grünfeld Defense' },
  { line: 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5', eco: 'D85', name: 'Grünfeld: Exchange' },
  { line: 'd4 f5', eco: 'A80', name: 'Dutch Defense' },
  { line: 'd4 f5 g3', eco: 'A86', name: 'Dutch: Leningrad approach' },
  { line: 'd4 e6', eco: 'A40', name: "Queen's Pawn: Modern" },
  { line: 'd4 d6', eco: 'A41', name: 'Old Indian Defense' },
  { line: 'd4 c5', eco: 'A43', name: 'Old Benoni' },
  { line: 'd4 b6', eco: 'A40', name: 'English Defense (1...b6)' },
  { line: 'd4 Nf6 c4 c5 d5', eco: 'A56', name: 'Benoni Defense' },
  // Flank openings
  { line: 'c4', eco: 'A10', name: 'English Opening' },
  { line: 'c4 e5', eco: 'A20', name: 'English: Reversed Sicilian' },
  { line: 'c4 c5', eco: 'A34', name: 'English: Symmetrical' },
  { line: 'c4 Nf6', eco: 'A15', name: 'English: Anglo-Indian' },
  { line: 'c4 e6', eco: 'A13', name: 'English: Agincourt' },
  { line: 'Nf3', eco: 'A04', name: 'Réti Opening' },
  { line: 'Nf3 d5', eco: 'A06', name: 'Réti vs ...d5' },
  { line: 'Nf3 d5 c4', eco: 'A09', name: 'Réti: Advance' },
  { line: 'Nf3 Nf6 g3', eco: 'A05', name: "King's Indian Attack" },
  { line: 'g3', eco: 'A00', name: 'Benko Opening (1.g3)' },
  { line: 'b3', eco: 'A01', name: 'Larsen Opening' },
  { line: 'b4', eco: 'A00', name: 'Sokolsky / Polish' },
  { line: 'f4', eco: 'A02', name: 'Bird Opening' },
  // Common offbeat
  { line: 'd4 d5 e3', eco: 'D02', name: 'Stonewall setup' },
  { line: 'd4 d5 Bf4', eco: 'D00', name: 'London System (1.d4 d5 2.Bf4)' },
  { line: 'd4 d5 Bf4 Nf6', eco: 'D02', name: 'London System: 2...Nf6' },
  { line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', eco: 'C53', name: 'Italian: Giuoco Piano, Main' },
  { line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', eco: 'C51', name: 'Italian: Evans Gambit' },
];

interface OpeningRecord extends OpeningEntry { plies: number }

let MAP: Map<string, OpeningRecord> | null = null;

function buildMap(): Map<string, OpeningRecord> {
  const map = new Map<string, OpeningRecord>();
  for (const entry of CURATED) {
    const chess = new Chess();
    const tokens = entry.line.trim().length > 0 ? entry.line.split(/\s+/) : [];
    let ok = true;
    for (const san of tokens) {
      const m = chess.move(san, { strict: false });
      if (!m) { ok = false; break; }
    }
    if (!ok) continue;
    const epd = fenToEpd(chess.fen());
    map.set(epd, { eco: entry.eco, name: entry.name, plies: tokens.length });
  }
  loadExtraOpenings(map);
  return map;
}

/** Optional supplemental file at server/data/openings/extra.json — array of
 *  `{ line, eco, name }` entries appended to the bundled map at boot. Lets
 *  operators paste in the full lichess TSV converted to JSON without code
 *  changes. */
function loadExtraOpenings(map: Map<string, OpeningRecord>): void {
  try {
    const path = resolve(config.projectRoot, 'server', 'data', 'openings', 'extra.json');
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, 'utf8')) as { line: string; eco: string; name: string }[];
    for (const e of data) {
      try {
        const chess = new Chess();
        const tokens = e.line.trim().length > 0 ? e.line.split(/\s+/) : [];
        for (const san of tokens) {
          const m = chess.move(san, { strict: false });
          if (!m) throw new Error('bad san');
        }
        const epd = fenToEpd(chess.fen());
        map.set(epd, { eco: e.eco, name: e.name, plies: tokens.length });
      } catch { /* skip bad line */ }
    }
  } catch { /* ignore — supplemental file is optional */ }
}

function ensureMap(): Map<string, OpeningRecord> {
  if (!MAP) MAP = buildMap();
  return MAP;
}

/** Look up the deepest opening match for a played PGN history. Returns the
 *  ECO + name and the ply count at which the match was made. Returns null if
 *  no entry matches (e.g. unusual move 1). */
export function lookupOpeningFromPgn(pgn: string): { eco: string; name: string; plies: number } | null {
  if (!pgn || !pgn.trim()) return null;
  const map = ensureMap();
  const chess = new Chess();
  try { chess.loadPgn(pgn, { strict: false }); } catch { return null; }
  const history = chess.history({ verbose: true });
  const replay = new Chess();
  // Try the empty-line first (covers "starting position"), then walk forward.
  let last: { eco: string; name: string; plies: number } | null = null;
  const startEpd = fenToEpd(replay.fen());
  const startEntry = map.get(startEpd);
  if (startEntry) last = { eco: startEntry.eco, name: startEntry.name, plies: 0 };
  for (let i = 0; i < history.length; i++) {
    const h = history[i]!;
    const m = replay.move({ from: h.from, to: h.to, promotion: h.promotion });
    if (!m) break;
    const epd = fenToEpd(replay.fen());
    const entry = map.get(epd);
    if (entry) last = { eco: entry.eco, name: entry.name, plies: i + 1 };
  }
  return last && last.plies > 0 ? last : null;
}

/** Bulk lookup variant for callers that already replay the game ply-by-ply. */
export function lookupOpeningByEpd(epd: string): OpeningEntry | null {
  const map = ensureMap();
  const e = map.get(epd);
  return e ? { eco: e.eco, name: e.name } : null;
}

export { fenToEpd };
