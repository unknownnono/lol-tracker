import { useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import {
  getFullSummonerProfile,
  getLatestDdragonVersion,
  getTopChampionMastery,
  getChampionIdNameMap,
  RiotApiError,
  PLATFORMS,
  Platform,
} from '@/lib/riot';
import { pushToServer, FAVORITES_KEY } from '@/lib/clientSync';

interface MatchSummary {
  matchId: string;
  championName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gameDuration: number;
  gameCreation: number;
  queueId: number;
  teamPosition: string;
}

interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

interface ActiveGameView {
  gameMode: string;
  gameQueueConfigId: number;
}

interface MasteryEntry {
  championName: string;
  championLevel: number;
  championPoints: number;
}

interface Props {
  error?: string;
  gameName?: string;
  tagLine?: string;
  platform?: string;
  puuid?: string;
  summonerLevel?: number;
  profileIconId?: number;
  leagueEntries?: LeagueEntry[];
  matches?: MatchSummary[];
  activeGame?: ActiveGameView | null;
  ddragonVersion?: string;
  masteries?: MasteryEntry[];
}

const POSITION_LABELS: Record<string, string> = {
  TOP: '탑',
  JUNGLE: '정글',
  MIDDLE: '미드',
  BOTTOM: '원딜',
  UTILITY: '서폿',
};

const QUEUE_NAMES: Record<number, string> = {
  420: '솔로랭크',
  440: '자유랭크',
  450: '칼바람나락',
  400: '일반(무작위)',
  430: '일반(협동전)',
};


function formatRelativeTime(gameCreation: number) {
  const diffMs = Date.now() - gameCreation;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 60) return `${Math.max(diffMin, 0)}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 30) return `${diffDay}일 전`;

  const d = new Date(gameCreation);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function kdaClass(kills: number, deaths: number, assists: number) {
  const ratio = (kills + assists) / Math.max(1, deaths);
  if (ratio >= 5) return 'kda-great';
  if (ratio >= 3) return 'kda-good';
  if (ratio < 2) return 'kda-bad';
  return 'kda-normal';
}

function WinRateDonut({ wins, losses, size = 64 }: { wins: number; losses: number; size?: number }) {
  const total = wins + losses;
  const pct = total ? Math.round((wins / total) * 100) : 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="#232935" strokeWidth={6} />
      <circle
        cx={center} cy={center} r={radius} fill="none" stroke="var(--blue)" strokeWidth={6}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text x={center} y={center + 5} textAnchor="middle" fontSize="14" fontWeight={700} fill="var(--text)">
        {pct}%
      </text>
    </svg>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const { region, name } = ctx.query;

  if (typeof region !== 'string' || typeof name !== 'string' || !PLATFORMS.includes(region as Platform)) {
    return { props: { error: '잘못된 주소입니다.' } };
  }

  const lastDash = name.lastIndexOf('-');
  if (lastDash === -1) {
    return { props: { error: '올바른 소환사 주소가 아닙니다. (예: /summoner/kr/이름-태그)' } };
  }
  const gameName = decodeURIComponent(name.slice(0, lastDash));
  const tagLine = decodeURIComponent(name.slice(lastDash + 1));

  try {
    const profile = await getFullSummonerProfile(gameName, tagLine, region as Platform);
    const ddragonVersion = await getLatestDdragonVersion();
    const [rawMasteries, championMap] = await Promise.all([
      getTopChampionMastery(profile.account.puuid, region as Platform, 5),
      getChampionIdNameMap(ddragonVersion),
    ]);
    const masteries: MasteryEntry[] = rawMasteries.map((m) => ({
      championName: championMap[m.championId] ?? 'Unknown',
      championLevel: m.championLevel,
      championPoints: m.championPoints,
    }));

    return {
      props: {
        gameName: profile.account.gameName,
        tagLine: profile.account.tagLine,
        platform: region,
        puuid: profile.account.puuid,
        summonerLevel: profile.summoner.summonerLevel,
        profileIconId: profile.summoner.profileIconId,
        leagueEntries: profile.leagueEntries,
        matches: profile.matches,
        activeGame: profile.activeGame
          ? { gameMode: profile.activeGame.gameMode, gameQueueConfigId: profile.activeGame.gameQueueConfigId }
          : null,
        ddragonVersion,
        masteries,
      },
    };
  } catch (err) {
    if (err instanceof RiotApiError) {
      const message = err.status === 404
        ? '해당 소환사를 찾을 수 없어요. 이름#태그와 지역을 다시 확인해주세요.'
        : err.message;
      return { props: { error: message } };
    }
    console.error(err);
    return { props: { error: '알 수 없는 오류가 발생했습니다.' } };
  }
};

export default function SummonerPage(props: Props) {
  const [tab, setTab] = useState<'matches' | 'champions' | 'mastery'>('matches');
  const [isFavorite, setIsFavorite] = useState(false);

  const favoriteKey = props.platform && props.gameName && props.tagLine
    ? `${props.platform}|${props.gameName}|${props.tagLine}`
    : null;

  useEffect(() => {
    if (!favoriteKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      setIsFavorite(saved.some((f: any) => `${f.platform}|${f.gameName}|${f.tagLine}` === favoriteKey));
    } catch {
      // 무시
    }
  }, [favoriteKey]);

  function toggleFavorite() {
    if (!favoriteKey || !props.platform || !props.gameName || !props.tagLine) return;
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      let next;
      if (isFavorite) {
        next = saved.filter((f: any) => `${f.platform}|${f.gameName}|${f.tagLine}` !== favoriteKey);
      } else {
        next = [{ platform: props.platform, gameName: props.gameName, tagLine: props.tagLine }, ...saved].slice(0, 20);
      }
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      setIsFavorite(!isFavorite);
      pushToServer();
    } catch {
      // localStorage 사용 불가 시 무시
    }
  }

  const championStats = useMemo(() => {
    if (!props.matches) return [];
    const map = new Map<
      string,
      { championName: string; games: number; wins: number; kills: number; deaths: number; assists: number }
    >();
    for (const m of props.matches) {
      const cur = map.get(m.championName) ?? {
        championName: m.championName, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
      };
      cur.games += 1;
      cur.wins += m.win ? 1 : 0;
      cur.kills += m.kills;
      cur.deaths += m.deaths;
      cur.assists += m.assists;
      map.set(m.championName, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.games - a.games);
  }, [props.matches]);

  if (props.error) {
    return (
      <div className="container">
        <Link className="back-link" href="/">← 다시 검색하기</Link>
        <div className="error-box">{props.error}</div>
      </div>
    );
  }

  const soloQueue = props.leagueEntries?.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const recentWins = props.matches?.filter((m) => m.win).length ?? 0;
  const recentTotal = props.matches?.length ?? 0;

  return (
    <div className="container">
      <Head>
        <title>{props.gameName}#{props.tagLine} 전적 - LoL 전적 검색</title>
        <meta
          name="description"
          content={`${props.gameName}#${props.tagLine}의 랭크, 최근 전적, 챔피언 통계를 확인하세요.${soloQueue ? ` 현재 ${soloQueue.tier} ${soloQueue.rank}.` : ''}`}
        />
        <meta property="og:title" content={`${props.gameName}#${props.tagLine} 전적`} />
        <meta
          property="og:description"
          content={soloQueue ? `${soloQueue.tier} ${soloQueue.rank} · ${soloQueue.leaguePoints} LP` : '랭크 정보 없음'}
        />
        <meta
          property="og:image"
          content={`https://ddragon.leagueoflegends.com/cdn/${props.ddragonVersion}/img/profileicon/${props.profileIconId}.png`}
        />
        <meta property="og:type" content="profile" />
        <meta name="twitter:card" content="summary" />
      </Head>
      <Link className="back-link" href="/">← 다시 검색하기</Link>

      {props.activeGame && (
        <div className="live-banner">
          <span className="live-dot" /> 현재 게임 중 · {QUEUE_NAMES[props.activeGame.gameQueueConfigId] ?? props.activeGame.gameMode}
        </div>
      )}

      <div className="profile-header">
        <div className="profile-icon-wrap">
          <img
            className="profile-icon"
            src={`https://ddragon.leagueoflegends.com/cdn/${props.ddragonVersion}/img/profileicon/${props.profileIconId}.png`}
            width={76} height={76} alt="프로필 아이콘"
          />
          <span className="level-badge">Lv. {props.summonerLevel}</span>
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="profile-name">
            {props.gameName}
            <span className="profile-tag"> #{props.tagLine}</span>
            <button className={`favorite-btn ${isFavorite ? 'active' : ''}`} onClick={toggleFavorite} aria-label="즐겨찾기">
              {isFavorite ? '★' : '☆'}
            </button>
          </h2>
        </div>
        <div className="recent-donut">
          <WinRateDonut wins={recentWins} losses={recentTotal - recentWins} size={56} />
          <span className="recent-donut-label">최근 {recentTotal}경기</span>
        </div>
      </div>

      {soloQueue ? (
        <div className="rank-strip">
          <div className="rank-info">
            <img
              className="tier-emblem"
              src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${soloQueue.tier.toLowerCase()}.png`}
              alt={soloQueue.tier}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="tier-text">
              <span className="tier">{soloQueue.tier} {soloQueue.rank} · {soloQueue.leaguePoints} LP</span>
              <span className="record">
                {soloQueue.wins}승 {soloQueue.losses}패 (
                {Math.round((soloQueue.wins / (soloQueue.wins + soloQueue.losses)) * 100)}%)
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="rank-strip unranked">솔로랭크 정보 없음 (배치 미완료 또는 언랭크)</div>
      )}

      <div className="tab-row">
        <button className={`tab-btn ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>최근 전적</button>
        <button className={`tab-btn ${tab === 'champions' ? 'active' : ''}`} onClick={() => setTab('champions')}>챔피언 통계</button>
        <button className={`tab-btn ${tab === 'mastery' ? 'active' : ''}`} onClick={() => setTab('mastery')}>마스터리</button>
      </div>

      {tab === 'matches' && (
        <div className="match-list">
          {recentTotal === 0 && (
            <div className="empty-state">최근 10경기 안에 플레이한 기록이 없어요. 배치 중이거나 오랜만에 접속한 계정일 수 있어요.</div>
          )}
          {props.matches?.map((m) => (
            <Link
              key={m.matchId}
              href={`/match/${props.platform}/${m.matchId}?puuid=${props.puuid}`}
              className={`match-row ${m.win ? 'win' : 'loss'}`}
            >
              <div className="match-meta">
                <div className="queue">{QUEUE_NAMES[m.queueId] ?? `기타(${m.queueId})`}</div>
                <div className="time">{formatRelativeTime(m.gameCreation)}</div>
              </div>
              {POSITION_LABELS[m.teamPosition] && (
                <span className="position-badge">{POSITION_LABELS[m.teamPosition]}</span>
              )}
              <img
                className="champion-icon"
                src={`https://ddragon.leagueoflegends.com/cdn/${props.ddragonVersion}/img/champion/${m.championName}.png`}
                alt={m.championName}
              />
              <div className="match-champion">{m.championName}</div>
              <div className={`kda ${kdaClass(m.kills, m.deaths, m.assists)}`}>
                {m.kills} / {m.deaths} / {m.assists}
              </div>
              <div className="result-tag">{m.win ? '승리' : '패배'}</div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'champions' && (
        <div className="champion-stat-list">
          <div className="champion-stat-note">최근 {recentTotal}경기 기준 집계입니다.</div>
          {championStats.length === 0 && (
            <div className="empty-state">집계할 최근 전적이 없어요.</div>
          )}
          {championStats.map((c) => {
            const winRate = Math.round((c.wins / c.games) * 100);
            const avgK = (c.kills / c.games).toFixed(1);
            const avgD = (c.deaths / c.games).toFixed(1);
            const avgA = (c.assists / c.games).toFixed(1);
            return (
              <div key={c.championName} className="champion-stat-row">
                <img
                  className="champion-icon"
                  src={`https://ddragon.leagueoflegends.com/cdn/${props.ddragonVersion}/img/champion/${c.championName}.png`}
                  alt={c.championName}
                />
                <div className="champion-stat-name">{c.championName}</div>
                <div className="stat-dim">{c.games}전 {c.wins}승 {c.games - c.wins}패</div>
                <div className={`kda ${kdaClass(c.kills, c.deaths, c.assists)}`}>{avgK} / {avgD} / {avgA}</div>
                <div className="champion-winrate">{winRate}%</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'mastery' && (
        <div className="champion-stat-list">
          <div className="champion-stat-note">숙련도가 가장 높은 챔피언 5개입니다.</div>
          {(!props.masteries || props.masteries.length === 0) && (
            <div className="empty-state">마스터리 정보가 없어요. 플레이한 챔피언이 없거나 아직 반영되지 않았을 수 있어요.</div>
          )}
          {props.masteries?.map((m) => (
            <div key={m.championName} className="champion-stat-row">
              <img
                className="champion-icon"
                src={`https://ddragon.leagueoflegends.com/cdn/${props.ddragonVersion}/img/champion/${m.championName}.png`}
                alt={m.championName}
              />
              <div className="champion-stat-name">{m.championName}</div>
              <div className="mastery-level">M{m.championLevel}</div>
              <div className="stat-dim">{m.championPoints.toLocaleString()} pts</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
