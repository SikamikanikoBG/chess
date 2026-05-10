# Patzer roadmap

A loose, opinionated list of where Patzer is headed. Items aren't promises — they're the maintainer's current view, and they shift. Open an issue / discussion if you want to nudge priority.

## Now (3.x)

- **Opening explorer.** ECO + book classification + Lichess opening-database lookup so the analyzer shows "Master games here: 47% white, 14% draw" at every position.
- **Tactic puzzles from your blunders.** Every `blunder` ply already has FEN + best move + played move stored. Replay them as puzzles, link back to the original game.
- **PvP draw / takeback / rematch.** The PvP lobby exists; the protocol is missing offer-draw, takeback-request, and one-click rematch.
- **Mobile play layout.** Sticky bottom action bar, swipe-up sheet for the moves panel, safe-area padding.
- **MultiPV in analyzer.** "Engine likes A, but B and C are also fine" plus a real `great`/`forced` move tier.
- **Stockfish strength tuning.** Use `UCI_LimitStrength` + `UCI_Elo` for kid/beginner/easy tiers instead of just `Skill Level`.

## Soon

- **Threats display.** "What's the opponent threatening here?" toggle in Game Review.
- **Mate-in-N display.** Show `M5` instead of `#` when the eval is mate.
- **Cross-platform setup.** `setup.sh` mirroring `setup.ps1`, or `npm run setup` that's OS-agnostic.
- **Test suite.** vitest with coverage on the classifier, ELO calibration, and PGN restore.
- **More languages.** Spanish and Russian are likely first wins.
- **Repertoire view.** Per-user opening tree — "you played the Najdorf 14× as Black, scored 64% accuracy".

## Maybe / later

- **Live demo at demo.patzer.app** (read-only, daily DB reset, rate-limited).
- **Annotation engine.** Auto-generate PGN comments like `{Threatening Nf6+ winning the queen}` from pre-computed facts.
- **Internal Glicko rating** between family-member profiles.
- **Position search.** "All my games where I had a backward pawn on d6."
- **Lichess study import / export.**

## Out of scope

- Variants (chess960, KOTH, 3-check). Classifier and coach assume standard chess.
- Cloud-hosted multi-tenant SaaS.
- Real-time spectator mode.
- ML-trained move classification (Stockfish + Lichess formula is the floor).
