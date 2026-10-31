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
  coreBuilds: BuildStat[]; // key "A>B>C": 완성 아이템 첫 3개 (칸 순서 ≈ 산 순서)
  fourthItems: BuildStat[];
  fifthItems: BuildStat[];
  sixthItems: BuildStat[];
  skills: SkillBuild | null; // 일반 칼바람(450) 기준 스킬 빌드·시작 아이템 (아수라장은 Riot API가 막아서)
}

// key: orders는 선마 순서("QEW"), sequences는 레벨별 순서("QWEQQRQEQEREEWW", 최대 15레벨)
export interface SkillBuild {
  queue: 450;
  sampleSize: number;
  orders: BuildStat[];
  sequences: BuildStat[];
  starts: BuildStat[]; // key "1055,2003,2003": 시작 1분 30초 안에 산 아이템 (정렬)
}

// GET /api/aram/champions 응답: 아수라장 챔피언 티어표 (보정 승률순). pickRate는 전체 경기 중 등장 비율
export interface ChampionStat {
  championId: number;
  games: number;
  winRate: number;
  pickRate: number;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
}
export interface ChampionTierResponse {
  queue: 2400;
  patches: string[];
  games: number;
  champions: ChampionStat[];
}

// GET /api/aram/combos — 같이 골랐을 때 좋은 증강 두 개 (lift: 두 증강 각자 승률 평균 대비 조합 승률 차이)
export interface ComboStat { a: number; b: number; games: number; winRate: number; lift: number }
export interface ComboResponse { queue: 2400; patches: string[]; combos: ComboStat[] }
// POST /api/aram/combo-ingest 표본 하나: 한 사람의 아수라장 한 판 (전적 목록에서)
export interface ComboSampleIn {
  gameId: number;
  gameVersion: string;
  gameDuration: number;
  earlySurrender: boolean;
  championId: number;
  win: boolean;
  augments: number[];
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
