// GET /api/aram/build 응답 타입. 데스크톱 앱(lol-tracker-desktop)이 이 파일을 그대로 복사해 씁니다.
export interface BuildStat {
  key: string; // 룬 조합 문자열, "작은ID-큰ID" 스펠, 아이템/증강 ID
  games: number;
  winRate: number; // 0~1, 소수 넷째 자리
  pickRate: number; // 0~1, 소수 넷째 자리
}

export interface AramBuildResponse {
  championId: number;
  queue: 450 | 2400;
  patch: string; // 데이터가 전혀 없으면 ''
  mergedPatches: string[];
  sampleSize: number;
  lowSample: boolean;
  runes: BuildStat[];
  spells: BuildStat[];
  coreItems: BuildStat[];
  boots: BuildStat[];
  augments: BuildStat[];
}

// POST /api/aram/ingest 요청·응답. 데스크톱 앱이 LCU 경기 상세를 이 형식으로 바꿔 보냅니다.
export interface IngestParticipant {
  championId: number;
  win: boolean;
  spell1Id: number;
  spell2Id: number;
  items: number[]; // item0~6, 정확히 7개 (빈 칸 0)
  perks: number[]; // perk0~5, 정확히 6개 (핵심 4 + 보조 2)
  perkPrimaryStyle: number;
  perkSubStyle: number;
  augments: number[]; // playerAugment1~6 중 0이 아닌 값, 최대 6개
}

export interface IngestGame {
  gameId: number;
  queueId: 450 | 2400;
  gameVersion: string; // 예: "16.21.123.4567"
  gameDuration: number; // 초
  earlySurrender: boolean;
  participants: IngestParticipant[]; // 정확히 10명
}

export interface IngestRequest {
  games: IngestGame[]; // 1~20개
}

export interface IngestResponse {
  accepted: number;
  duplicates: number;
  rejected: number;
}
