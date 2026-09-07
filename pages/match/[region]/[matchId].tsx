import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { getMatchDetail, getLatestDdragonVersion, RiotApiError, PLATFORMS, Platform, SUMMONER_SPELLS, RUNE_STYLES } from '@/lib/riot';

interface ParticipantView {
  puuid: string;
  riotName: string;
  championName: string;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  goldEarned: number;
  damage: number;
  items: number[];
  summoner1Id: number;
  summoner2Id: number;
  primaryStyle: number;
  subStyle: number;
}

interface Props {
  error?: string;
  platform?: string;
  matchId?: string;
  queueId?: number;
  gameDuration?: number;
  highlightPuuid?: string | null;
  participants?: ParticipantView[];
  ddragonVersion?: string;
}

const QUEUE_NAMES: Record<number, string> = {
  420: '솔로랭크', 440: '자유랭크', 450: '칼바람나락', 400: '일반(무작위)', 430: '일반(협동전)',
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}분 ${s}초`;
}

function kdaClass(kills: number, deaths: number, assists: number) {
  const ratio = (kills + assists) / Math.max(1, deaths);
  if (ratio >= 5) return 'kda-great';
  if (ratio >= 3) return 'kda-good';
  if (ratio < 2) return 'kda-bad';
  return 'kda-normal';
}

// 아주 단순화한 추정 등급입니다 (op.gg 등의 실제 산정 방식과는 다릅니다).
function estimateGrade(p: ParticipantView, gameDurationSec: number): 'S+' | 'S' | 'A' | 'B' | 'C' {
  const kda = (p.kills + p.assists) / Math.max(1, p.deaths);
  const csPerMin = p.cs / Math.max(1, gameDurationSec / 60);
  const score = kda * 2 + csPerMin * 0.4 + (p.win ? 2 : 0);
  if (score >= 15) return 'S+';
  if (score >= 10.5) return 'S';
  if (score >= 7) return 'A';
  if (score >= 4) return 'B';
  return 'C';
}

function gradeClass(grade: string) {
  if (grade === 'S+') return 'splus';
  if (grade === 'S') return 's';
  if (grade === 'A') return 'a';
  if (grade === 'B') return 'b';
  return 'c';
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const { region, matchId, puuid } = ctx.query;

  if (typeof region !== 'string' || typeof matchId !== 'string' || !PLATFORMS.includes(region as Platform)) {
    return { props: { error: '잘못된 주소입니다.' } };
  }

  try {
    const match = await getMatchDetail(matchId, region as Platform);
    const ddragonVersion = await getLatestDdragonVersion();
    const participants: ParticipantView[] = match.info.participants.map((p: any) => ({
      puuid: p.puuid,
      riotName: p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline}` : p.summonerName || '알 수 없음',
      championName: p.championName,
      teamId: p.teamId,
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
      goldEarned: p.goldEarned,
      damage: p.totalDamageDealtToChampions || 0,
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      summoner1Id: p.summoner1Id,
      summoner2Id: p.summoner2Id,
      primaryStyle: p.perks?.styles?.[0]?.style ?? 0,
      subStyle: p.perks?.styles?.[1]?.style ?? 0,
    }));

    return {
      props: {
        platform: region,
        matchId,
        queueId: match.info.queueId,
        gameDuration: match.info.gameDuration,
        highlightPuuid: typeof puuid === 'string' ? puuid : null,
        participants,
        ddragonVersion,
      },
    };
  } catch (err) {
    if (err instanceof RiotApiError) {
      return { props: { error: err.message } };
    }
    console.error(err);
    return { props: { error: '매치 정보를 불러오는 중 오류가 발생했습니다.' } };
  }
};

function TeamBlock({
  team, highlightPuuid, gameDuration, maxDamage, ddragonVersion,
}: { team: ParticipantView[]; highlightPuuid?: string | null; gameDuration: number; maxDamage: number; ddragonVersion: string }) {
  const win = team[0]?.win;
  return (
    <div className="team-block">
      <div className={`team-heading ${win ? 'win' : 'loss'}`}>{win ? '승리 팀' : '패배 팀'}</div>
      {team.map((p) => {
        const grade = estimateGrade(p, gameDuration);
        const damagePct = maxDamage > 0 ? Math.round((p.damage / maxDamage) * 100) : 0;
        return (
          <div key={p.puuid} className={`participant-row ${p.puuid === highlightPuuid ? 'me' : ''}`}>
            <div className="champ-cluster">
              <img
                className="champion-icon"
                src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${p.championName}.png`}
                alt={p.championName}
              />
              <div className="spell-rune-col">
                <div className="spell-pair">
                  {[p.summoner1Id, p.summoner2Id].map((sid, i) =>
                    SUMMONER_SPELLS[sid] ? (
                      <img
                        key={i}
                        className="spell-icon"
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${SUMMONER_SPELLS[sid]}`}
                        alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    ) : (
                      <div key={i} className="spell-icon" />
                    )
                  )}
                </div>
                {RUNE_STYLES[p.primaryStyle] && (
                  <img
                    className="rune-icon"
                    src={`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/${RUNE_STYLES[p.primaryStyle]}`}
                    alt=""
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  />
                )}
              </div>
            </div>
            <div className="participant-name">{p.riotName}</div>
            <div className={`kda ${kdaClass(p.kills, p.deaths, p.assists)}`}>
              {p.kills} / {p.deaths} / {p.assists}
            </div>
            <div className={`grade-badge ${gradeClass(grade)}`}>{grade}</div>
            <div className="stat-dim">CS {p.cs}</div>
            <div className="stat-dim">{p.goldEarned.toLocaleString()}G</div>
            <div className="damage-cell">
              <div className="damage-bar-track">
                <div className="damage-bar-fill" style={{ width: `${damagePct}%` }} />
              </div>
              <span className="damage-value">{p.damage.toLocaleString()}</span>
            </div>
            <div className="item-row">
              {p.items.map((itemId, i) =>
                itemId ? (
                  <img
                    key={i}
                    className="item-slot"
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${itemId}.png`}
                    alt=""
                  />
                ) : (
                  <div key={i} className="item-slot" />
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MatchDetailPage(props: Props) {
  const router = useRouter();

  if (props.error) {
    return (
      <div className="container">
        <a className="back-link" onClick={() => router.back()} style={{ cursor: 'pointer' }}>← 뒤로가기</a>
        <div className="error-box">{props.error}</div>
      </div>
    );
  }

  const team1 = props.participants?.filter((p) => p.teamId === 100) ?? [];
  const team2 = props.participants?.filter((p) => p.teamId === 200) ?? [];
  const duration = props.gameDuration ?? 0;
  const maxDamage = Math.max(1, ...(props.participants?.map((p) => p.damage) ?? [1]));

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <a className="back-link" onClick={() => router.back()} style={{ cursor: 'pointer' }}>← 뒤로가기</a>

      <div className="match-detail-header">
        <h2>{QUEUE_NAMES[props.queueId ?? 0] ?? `기타(${props.queueId})`}</h2>
        <div className="sub">
          {props.gameDuration !== undefined ? formatDuration(props.gameDuration) : ''}
          {' · 등급은 간단 추정치입니다'}
        </div>
      </div>

      <TeamBlock team={team1} highlightPuuid={props.highlightPuuid} gameDuration={duration} maxDamage={maxDamage} ddragonVersion={props.ddragonVersion ?? ''} />
      <TeamBlock team={team2} highlightPuuid={props.highlightPuuid} gameDuration={duration} maxDamage={maxDamage} ddragonVersion={props.ddragonVersion ?? ''} />
    </div>
  );
}
