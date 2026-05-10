# ♞ chess

Self-hosted, multilingual chess platform for you and your family.
A "private chess.com" that runs in a single Docker container on your home server.

- **Game Review** — pull your public games from Chess.com, analyze with Stockfish, get Lichess-style classifications (Best / Good / Inaccuracy / Mistake / Blunder), accuracy %, and an evaluation graph.
- **Play vs Bot** — full games against Stockfish at named difficulty tiers (Kid / Beginner / Easy / Medium / Hard / Master / Stockfish max), with standard time controls.
- **AI Coach** — local Ollama (your own models, runs offline) explains moves in natural language, gives hints, and adapts the explanation depth to the player (Kid / Beginner / Intermediate / Advanced).
- **Multilingual** — full English + Bulgarian UI, plus Bulgarian-aware coach. The kid logs in to a profile preconfigured for their language and audience level — no settings to fiddle with.
- **Browser TTS** — uses your operating system's installed voices (Windows SAPI, macOS, etc). Free, private, offline.
- **Multi-user with admin console** — first-run wizard creates an admin; the admin creates additional profiles. Per-profile language / coach behavior / TTS / Chess.com username.

## Quick start (Docker, recommended)

```bash
git clone https://github.com/<you>/chess.git
cd chess
docker compose up -d --build
```

Open `http://<your-server>:8800`. The first visit walks you through the setup wizard.

You'll need:
- An [Ollama](https://ollama.com) server reachable from the chess container (for the AI Coach). Any host on your network works — set the URL in the wizard.
- A Chess.com username (entered later in *Settings*) if you want to import games for review. Optional.

To use a different host port, set `HOST_PORT` in `.env` or pass it inline:
```bash
HOST_PORT=9000 docker compose up -d --build
```

## Local development

Requires Node.js ≥ 20. On Windows, run `setup.ps1` once to download Stockfish into `./bin/`. On Linux/macOS, install Stockfish via your package manager (`apt install stockfish`, `brew install stockfish`, etc.).

```bash
npm install
npm run dev
```

- Server: `http://localhost:8800`
- Vite dev server (with HMR): `http://localhost:5173` — proxies `/api` and `/ws` to the server.

## Deploying to a home server

A simple `deploy.ps1` is included. Create `.env.deploy` (gitignored):

```
HOST=user@192.168.x.x
REMOTE_DIR=/home/user/chess
SUDO_PASS=... # only if your user is not in the docker group
HOST_PORT=8800
```

Then:

```powershell
.\deploy.ps1            # tars source → ssh, builds & starts
.\deploy.ps1 -NoBuild   # restart without rebuilding
.\deploy.ps1 -Logs      # tail logs after deploy
```

## Configuration

All user-facing configuration is done **through the UI** and persisted in SQLite. The only environment variables are operational:

| Var | Default | What it does |
|---|---|---|
| `PORT` | `8800` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/chess.db` | SQLite database file |
| `STOCKFISH_PATH` | (auto) | Override Stockfish binary path |
| `SESSION_SECRET` | (auto-generated) | Cookie signing secret. Persisted on first run. |

System settings (Ollama URL, default coach model, Stockfish path override) live in *Admin → System*.
Per-profile settings (language, audience, coach behavior, TTS voice, Chess.com username) live in *Settings*.

## How move classification works

Each played move is compared against the engine's best move at the same position. The "win percentage" is computed from the centipawn evaluation (Lichess formula), and the difference between the win % before and after the move determines the classification:

| Classification | Centipawn loss |
|---|---|
| Best ★ | ≤10, or exactly the engine's top choice |
| Excellent ✓ | ≤25 |
| Good · | ≤50 |
| Inaccuracy ?! | ≤100 |
| Mistake ? | ≤250 |
| Blunder ?? | >250 |

Per-game accuracy % is the average of per-move accuracies (Lichess formula: `103.1668 · exp(-0.04354 · Δwin%) - 3.1669`, clamped to [0, 100]).

## Tech

- **Server:** Node 20 · TypeScript · [Hono](https://hono.dev) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · [chess.js](https://github.com/jhlywa/chess.js) · `ws` · native [Stockfish](https://stockfishchess.org/)
- **Web:** React 18 · Vite · Tailwind CSS · [chessground](https://github.com/lichess-org/chessground) · Recharts · framer-motion · react-i18next · TanStack Query
- **Coach:** [Ollama](https://ollama.com) (default model: `gemma3:1b`, recommend `gemma4:26b` for quality)
- **TTS:** browser Web Speech API (uses installed OS voices)
- **Persistence:** single SQLite file in `./data/`

## License

MIT — see [LICENSE](./LICENSE).
