# chess.com accuracy benchmark

- Source: Hikaru April 2026 archive (10 games, all blitz, 37–59 plies)
- Our depth: 16, Stockfish, MultiPV=3 (container default threads/hash)
- Run completed in 6.5 min

## Summary

| metric | value |
|---|---|
| games | 10 |
| data points (sides × games) | 20 |
| **MAE vs chess.com** | **5.32** |
| mean signed bias (ours − ref) | -0.29 |
| max absolute delta | 21.47 |
| within ±3 pts | 45% |
| within ±5 pts | 70% |

## Per-game

| # | game | plies | side | ref | ours | Δ | our Elo | counts |
|---|---|---:|---|---:|---:|---:|---:|---|
| 1 | [Swiss_Fighter vs Hikaru](https://www.chess.com/game/live/167376820568) | 48 | W | 68.08 | 70.9 | +2.82 | 1258 | book:2 best:16 exce:9 inac:7 good:4 mist:3 blun:2 grea:4 miss:1 |
| | | | B | 71.33 | 73.2 | +1.87 | 1323 | |
| 2 | [morphy1984 vs Hikaru](https://www.chess.com/game/live/167225017146) | 56 | W | 67.03 | 80.2 | +13.17 | 1282 | book:3 exce:9 best:20 good:7 inac:8 grea:5 blun:1 mist:1 miss:2 |
| | | | B | 77.05 | 92.7 | +15.65 | 1589 | |
| 3 | [Hikaru vs silentvacance](https://www.chess.com/game/live/167969868798) | 59 | W | 88.69 | 94.8 | +6.11 | 2018 | book:3 exce:17 good:11 best:17 inac:3 mist:1 grea:2 blun:1 miss:1 forc:3 |
| | | | B | 72.79 | 77.3 | +4.51 | 1447 | |
| 4 | [morphy1984 vs Hikaru](https://www.chess.com/game/live/166910114456) | 40 | W | 84.34 | 74.6 | -9.74 | 1507 | book:5 best:19 exce:4 good:7 inac:3 blun:1 grea:1 |
| | | | B | 96.33 | 95.9 | -0.43 | 2384 | |
| 5 | [Swiss_Fighter vs Hikaru](https://www.chess.com/game/live/167966251006) | 40 | W | 82.89 | 79 | -3.89 | 1600 | book:2 exce:8 good:8 inac:2 best:16 blun:1 grea:3 |
| | | | B | 93.56 | 97 | +3.44 | 2544 | |
| 6 | [Hikaru vs ASCeNDer21](https://www.chess.com/game/live/167541093122) | 45 | W | 83.4 | 83.9 | +0.5 | 1634 | book:3 exce:10 good:3 best:14 inac:7 grea:4 mist:2 miss:1 blun:1 |
| | | | B | 75.37 | 75.5 | +0.13 | 1342 | |
| 7 | [silentvacance vs Hikaru](https://www.chess.com/game/live/167970248404) | 37 | W | 85.33 | 85.8 | +0.47 | 1788 | book:2 good:8 exce:14 best:8 inac:2 grea:2 mist:1 |
| | | | B | 93.4 | 95.1 | +1.7 | 2444 | |
| 8 | [Hikaru vs NodariousBIG](https://www.chess.com/game/live/167170824078) | 43 | W | 98.63 | 97.5 | -1.13 | 2745 | book:2 exce:16 best:15 good:2 mist:1 grea:6 blun:1 |
| | | | B | 87.4 | 78 | -9.4 | 1581 | |
| 9 | [Hikaru vs PyrihRoman](https://www.chess.com/game/live/167829483494) | 43 | W | 96.34 | 91.7 | -4.64 | 2105 | book:5 best:15 good:11 exce:7 mist:3 grea:2 |
| | | | B | 86.76 | 82.3 | -4.46 | 1557 | |
| 10 | [GMAkobianSTL vs Hikaru](https://www.chess.com/game/live/171703250297) | 44 | W | 88.67 | 67.2 | -21.47 | 1608 | book:5 good:9 exce:11 best:16 inac:1 mist:1 blun:1 |
| | | | B | 97.13 | 96.2 | -0.93 | 2385 | |
