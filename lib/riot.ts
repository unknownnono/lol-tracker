// Riot API와 통신하는 모든 로직을 이 파일 하나에 모아둡니다.
// 서버(API Route, getServerSideProps)에서만 import해서 사용하세요 — API 키가 노출되면 안 됩니다.

const RIOT_API_KEY = process.env.RIOT_API_KEY;

export const PLATFORMS = [
  'na1', 'euw1', 'eun1', 'kr', 'jp1', 'br1',
  'la1', 'la2', 'oc1', 'tr1', 'ru',
  'ph2', 'sg2', 'th2', 'tw2', 'vn2',
] as const;
export type Platform = (typeof PLATFORMS)[number];

const PLATFORM_TO_REGIONAL: Record<Platform, 'americas' | 'asia' | 'europe' | 'sea'> = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas',
  kr: 'asia', jp1: 'asia',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

function regionalOf(platform: Platform) {
  return PLATFORM_TO_REGIONAL[platform];
}

// ---------- 아주 가벼운 인메모리 캐시 ----------
// 서버 프로세스가 살아있는 동안만 유지됩니다 (재시작하면 초기화).
// 실제 서비스로 배포한다면 이 부분을 Redis 등으로 교체하는 걸 권장합니다.
const cache = new Map<string, { data: unknown; expires: number }>();

async function riotFetch<T>(url: string, ttlMs = 0): Promise<T> {
  if (ttlMs > 0) {
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) {
      return hit.data as T;
    }
  }

  if (!RIOT_API_KEY) {
    throw new Error('RIOT_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인하세요.');
  }
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 404) throw new RiotApiError('찾을 수 없습니다.', 404);
    if (res.status === 429) throw new RiotApiError('요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
    if (res.status === 403) throw new RiotApiError('API 키가 유효하지 않거나 만료되었습니다.', 403);
    throw new RiotApiError(`Riot API 오류 (${res.status})`, res.status);
  }

  const data = (await res.json()) as T;
  if (ttlMs > 0) cache.set(url, { data, expires: Date.now() + ttlMs });
  return data;
}

export class RiotApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface Summoner {
  id: string;
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
}

export interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface ActiveGame {
  gameId: number;
  gameMode: string;
  gameType: string;
  gameQueueConfigId: number;
  participants: {
    puuid: string;
    riotId?: string;
    championId: number;
    teamId: number;
  }[];
}

// 소환사 주문(스펠) ID -> Data Dragon 이미지 파일명
export const SUMMONER_SPELLS: Record<number, string> = {
  1: 'SummonerBoost.png', // 정화
  3: 'SummonerExhaust.png', // 탈진
  4: 'SummonerFlash.png', // 점멸
  6: 'SummonerHaste.png', // 유체화
  7: 'SummonerHeal.png', // 회복
  11: 'SummonerSmite.png', // 강타
  12: 'SummonerTeleport.png', // 순간이동
  13: 'SummonerMana.png', // 총명
  14: 'SummonerDot.png', // 점화
  21: 'SummonerBarrier.png', // 방어막
  32: 'SummonerSnowball.png', // 표식(칼바람)
};

// 룬 스타일(트리) ID -> 아이콘 파일명 (Community Dragon)
export const RUNE_STYLES: Record<number, string> = {
  8000: '7201_precision.png', // 정밀
  8100: '7200_domination.png', // 지배
  8200: '7202_sorcery.png', // 마법
  8300: '7203_whimsy.png', // 영감
  8400: '7204_resolve.png', // 결의
};

export async function getAccountByRiotId(gameName: string, tagLine: string, platform: Platform) {
  const regional = regionalOf(platform);
  const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch<RiotAccount>(url, 10 * 60 * 1000);
}

export async function getSummonerByPuuid(puuid: string, platform: Platform) {
  const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return riotFetch<Summoner>(url, 5 * 60 * 1000);
}

export async function getLeagueEntries(puuid: string, platform: Platform) {
  const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
  return riotFetch<LeagueEntry[]>(url, 60 * 1000);
}

export async function getRecentMatchIds(puuid: string, platform: Platform, count = 10) {
  const regional = regionalOf(platform);
  const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
  return riotFetch<string[]>(url, 30 * 1000);
}

export async function getMatchDetail(matchId: string, platform: Platform) {
  const regional = regionalOf(platform);
  const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  // 끝난 매치의 데이터는 절대 바뀌지 않으니 오래(하루) 캐싱해도 안전합니다.
  return riotFetch<any>(url, 24 * 60 * 60 * 1000);
}

// 현재 게임 중인지 조회. 게임 중이 아니면 null을 반환합니다 (에러 아님).
export async function getActiveGame(puuid: string, platform: Platform): Promise<ActiveGame | null> {
  const url = `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;
  try {
    return await riotFetch<ActiveGame>(url, 10 * 1000);
  } catch (err) {
    if (err instanceof RiotApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getFullSummonerProfile(gameName: string, tagLine: string, platform: Platform) {
  const account = await getAccountByRiotId(gameName, tagLine, platform);
  const summoner = await getSummonerByPuuid(account.puuid, platform);
  const [leagueEntries, matchIds, activeGame] = await Promise.all([
    getLeagueEntries(account.puuid, platform),
    getRecentMatchIds(account.puuid, platform, 10),
    getActiveGame(account.puuid, platform),
  ]);

  const matches = await Promise.all(matchIds.map((id) => getMatchDetail(id, platform)));

  const matchSummaries = matches.map((m) => {
    const participant = m.info.participants.find((p: any) => p.puuid === account.puuid);
    return {
      matchId: m.metadata.matchId,
      championName: participant.championName,
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      gameDuration: m.info.gameDuration,
      gameCreation: m.info.gameCreation,
      queueId: m.info.queueId,
    };
  });

  return { account, summoner, leagueEntries, matches: matchSummaries, activeGame };
}
