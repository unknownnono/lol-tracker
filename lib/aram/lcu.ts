// 롤 클라이언트(LCU) 관련 순수 함수. 데스크톱 앱(lol-tracker-desktop)이 이 파일을 그대로 복사해 씁니다.
// - 실행 인자에서 접속 정보 추출
// - 경기 상세(/lol-match-history/v1/games/{gameId}) → 수집 요청 형식 (이름·puuid 등 개인 정보는 넣지 않음)
import type { IngestGame, IngestParticipant } from './types';

export function parseLcuCredentials(commandLine: string): { port: number; token: string } | null {
  const port = commandLine.match(/--app-port=(\d+)/)?.[1];
  const token = commandLine.match(/--remoting-auth-token=([\w-]+)/)?.[1];
  return port && token ? { port: Number(port), token } : null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toParticipant(p: any): IngestParticipant {
  const s = p.stats ?? {};
  return {
    championId: num(p.championId),
    win: Boolean(s.win),
    spell1Id: num(p.spell1Id),
    spell2Id: num(p.spell2Id),
    items: [0, 1, 2, 3, 4, 5, 6].map((i) => num(s[`item${i}`])),
    perks: [0, 1, 2, 3, 4, 5].map((i) => num(s[`perk${i}`])),
    perkPrimaryStyle: num(s.perkPrimaryStyle),
    perkSubStyle: num(s.perkSubStyle),
    augments: [1, 2, 3, 4, 5, 6].map((i) => num(s[`playerAugment${i}`])).filter((v) => v > 0),
  };
}

export function lcuGameToIngest(game: any): IngestGame | null {
  if (!game || (game.queueId !== 450 && game.queueId !== 2400)) return null;
  if (!Array.isArray(game.participants) || typeof game.gameVersion !== 'string' || !game.gameId) return null;
  return {
    gameId: game.gameId,
    queueId: game.queueId,
    gameVersion: game.gameVersion,
    gameDuration: num(game.gameDuration),
    earlySurrender: game.participants.some((p: any) => p.stats?.gameEndedInEarlySurrender === true),
    participants: game.participants.map(toParticipant),
  };
}
