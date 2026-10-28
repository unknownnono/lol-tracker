// 테스트용 수집 요청 데이터 (LCU에서 읽어 앱이 변환한 형식)
import type { IngestGame, IngestParticipant } from '@/lib/aram/types';

export const RABADON = 3089; // 완성 아이템
export const SORC_SHOES = 3020; // 신발
export const CLASSES = { completed: new Set([RABADON]), boots: new Set([SORC_SHOES]) };
export const DEFAULT_RUNE_KEY = '8200:8229-8226-8210-8237:8300:8345-8347';

export function makeIngestParticipant(over: Partial<IngestParticipant> = {}): IngestParticipant {
  return {
    championId: 1,
    win: true,
    spell1Id: 32,
    spell2Id: 4,
    items: [RABADON, SORC_SHOES, 0, 0, 0, 0, 3340],
    perks: [8229, 8226, 8210, 8237, 8345, 8347],
    perkPrimaryStyle: 8200,
    perkSubStyle: 8300,
    augments: [1336, 1134, 3085, 1238],
    ...over,
  };
}

export function makeIngestGame(over: Partial<IngestGame> = {}): IngestGame {
  return {
    gameId: 1000000001,
    queueId: 2400,
    gameVersion: '16.21.123.4567',
    gameDuration: 1100,
    earlySurrender: false,
    participants: Array.from({ length: 10 }, (_, i) => makeIngestParticipant({ championId: i + 1, win: i < 5 })),
    ...over,
  };
}
