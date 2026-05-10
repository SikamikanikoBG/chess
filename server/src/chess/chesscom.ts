// Chess.com public API client. The API is unauthenticated but requires a User-Agent.

const UA = 'chess-local/0.1 (+https://github.com/local/chess)';

interface Archive { url: string }
interface ArchivesResponse { archives: string[] }

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface MonthlyArchive { games: ChessComGame[] }

async function get(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new Error(`chesscom_${res.status}`);
  return res.json();
}

export async function getPlayer(username: string): Promise<{ username: string; avatar?: string; country?: string } | null> {
  try {
    const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    return {
      username: String(data.username ?? username),
      avatar: typeof data.avatar === 'string' ? data.avatar : undefined,
      country: typeof data.country === 'string' ? data.country : undefined,
    };
  } catch {
    return null;
  }
}

export async function listArchives(username: string): Promise<string[]> {
  const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`)) as ArchivesResponse;
  return data.archives ?? [];
}

export async function getMonth(archiveUrl: string): Promise<ChessComGame[]> {
  const data = (await get(archiveUrl)) as MonthlyArchive;
  return data.games ?? [];
}

// Fetch the most recent N games for a user, walking archives backwards in time.
export async function fetchRecentGames(username: string, limit: number): Promise<ChessComGame[]> {
  const archives = await listArchives(username);
  const out: ChessComGame[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < limit; i--) {
    const url = archives[i];
    if (!url) continue;
    const games = await getMonth(url);
    games.sort((a, b) => b.end_time - a.end_time);
    for (const g of games) {
      out.push(g);
      if (out.length >= limit) break;
    }
  }
  return out;
}
